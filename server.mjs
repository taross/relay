import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import process from "node:process";
import { createServer as createViteServer, loadEnv } from "vite";
import { checkDatabase, getDatabaseConfig } from "./db/client.mjs";
import { writeConstraintEvaluations } from "./db/evaluation-repository.mjs";
import { readState, writeState } from "./db/state-repository.mjs";

const mode = process.env.NODE_ENV === "production" ? "production" : "development";
const fileEnv = loadEnv(mode, process.cwd(), "");
const env = { ...fileEnv, ...process.env };
const port = Number(env.PORT ?? 5173);
const host = env.HOST ?? "0.0.0.0";

export function readJevConfig(source = env) {
  const apiKey = source.JEV_API_KEY?.trim();
  return {
    apiKey,
    baseUrl: source.JEV_API_BASE_URL?.trim() || undefined,
    configured: Boolean(apiKey),
  };
}

const jev = readJevConfig();
const database = getDatabaseConfig(env);
const vite = mode === "development" ? await createViteServer({ server: { middlewareMode: true }, appType: "spa" }) : undefined;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function scoreQuestion(instructions) {
  return {
    type: "score",
    instructions,
    criteria: [
      "問題がなく、そのまま進められる",
      "軽微な注意点はあるが、通常の運用で制御できる",
      "明示的な制約を守れば進められる",
      "重大な懸念があり、計画の修正を優先する",
      "許容できない問題があり、この計画では進められない",
    ],
  };
}

async function evaluateReleasePlan(payload) {
  if (!jev.configured) throw Object.assign(new Error("JEV_API_KEY is not configured"), { status: 503 });
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates.slice(0, 8) : [];
  if (candidates.length === 0) throw Object.assign(new Error("At least one plan candidate is required"), { status: 400 });
  const candidateCriteria = Object.fromEntries(candidates.map((candidate) => [candidate.id, `${candidate.name}: ${candidate.summary} 指標: ${JSON.stringify(candidate.metrics ?? {})} 選択理由: ${(candidate.rationale ?? []).join(" ")} トレードオフ: ${(candidate.tradeoffs ?? []).join(" ")} 制約: ${(candidate.constraints ?? []).join(" ")}`]));
  const upstream = await fetch(jev.baseUrl || "https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${jev.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: payload.state,
      questions: {
        selected_plan: { type: "choice", instructions: "state.planningPolicyの目的と優先事項に最も適合する実行可能な候補を選んでください。後方互換の必須条件と分割可否は守り、期限、継続運用、調整コスト、復旧可能性のトレードオフを比較してください。リスクが低いという理由だけで選ばないでください。", criteria: candidateCriteria },
        recommendation: { type: "choice", instructions: "選択した計画を承認申請へ進めるべきか評価してください。決定的なルール違反は別のルールエンジンが判定します。", criteria: { accept: "追加制約なしで申請へ進められる", accept_with_constraints: "明示された運用上の制約を守る場合に申請へ進められる", revise: "申請前に計画を修正する必要がある", reject: "候補の前提では許容できない" } },
        risk: scoreQuestion("選択した計画の総合リスクを評価してください。"),
        compatibility: scoreQuestion("新旧バージョンとAPI・schemaの互換性リスクを評価してください。"),
        rollout: scoreQuestion("反映順序と段階配信のリスクを評価してください。"),
        recovery: scoreQuestion("障害時の停止と復旧のリスクを評価してください。"),
        verification: scoreQuestion("必要な検証を実行して結果を判定できるか評価してください。"),
        schedule: scoreQuestion("予定時刻、待機期間、外部審査を含む日程リスクを評価してください。"),
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = result?.error?.message || result?.message || `Jev API returned ${upstream.status}`;
    throw Object.assign(new Error(message), { status: upstream.status >= 500 ? 502 : upstream.status });
  }
  const answers = result.answers ?? {};
  const recommendationMap = { accept: "accept", accept_with_constraints: "accept-with-conditions", revise: "revise", reject: "reject" };
  const selectedPlanId = answers.selected_plan?.choice;
  const recommendation = recommendationMap[answers.recommendation?.choice];
  if (!candidateCriteria[selectedPlanId] || !recommendation) throw Object.assign(new Error("Jev API returned an invalid decision shape"), { status: 502 });
  const score = (name) => Math.max(1, Math.min(5, Number(answers[name]?.score ?? 2) + 1));
  return {
    recommendation,
    selectedPlanId,
    riskScore: score("risk"),
    confidence: Number(answers.recommendation?.confidence ?? 0),
    categories: { compatibility: score("compatibility"), rollout: score("rollout"), recovery: score("recovery"), verification: score("verification"), schedule: score("schedule") },
    evaluatedAt: new Date().toISOString(),
    mock: false,
    provider: { id: result.id, model: result.model, usage: result.usage },
  };
}

async function reviewVerification(payload) {
  if (!jev.configured) throw Object.assign(new Error("JEV_API_KEY is not configured"), { status: 503 });
  if (!Array.isArray(payload?.verificationPlans) || payload.verificationPlans.length === 0) throw Object.assign(new Error("At least one verification plan is required"), { status: 400 });
  const upstream = await fetch(jev.baseUrl || "https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { Authorization: `Bearer ${jev.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "jev-latest", state: payload, questions: { verdict: { type: "choice", instructions: "チームが明示したチェンジログ、検証方法、成功条件、実施条件、必要な証跡が、今回の変更内容とリスクに整合するか評価してください。未記載の検証方法や必要な証跡を推測・生成しないでください。入力が不足して妥当性を確認できない場合はneeds_reviewを選んでください。", criteria: { adequate: "明示された検証計画が変更内容と既知のリスクを十分に扱っている", needs_review: "計画の記載不足または変更内容との不整合があり、担当チームによる見直しが必要である" } } } }), signal: AbortSignal.timeout(15_000) });
  const result = await upstream.json().catch(() => ({})); if (!upstream.ok) throw Object.assign(new Error(result?.error?.message || result?.message || `Jev API returned ${upstream.status}`), { status: upstream.status >= 500 ? 502 : upstream.status }); const choice = result.answers?.verdict?.choice; if (!["adequate", "needs_review"].includes(choice)) throw Object.assign(new Error("Jev API returned an invalid verification review"), { status: 502 }); return { verdict: choice === "needs_review" ? "needs-review" : "adequate", confidence: Number(result.answers.verdict?.confidence ?? 0), evaluatedAt: new Date().toISOString(), provider: { id: result.id, model: result.model, usage: result.usage } };
}

function serveBuiltApp(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(process.cwd(), "dist", requested === "/" ? "index.html" : requested);
  const target = existsSync(candidate) && !candidate.endsWith("/") ? candidate : join(process.cwd(), "dist", "index.html");
  response.writeHead(200, { "Content-Type": mimeTypes.get(extname(target)) ?? "application/octet-stream" });
  createReadStream(target).pipe(response);
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/jev/status") {
    sendJson(response, 200, { configured: jev.configured });
    return;
  }
  if (request.method === "GET" && request.url === "/api/db/status") {
    checkDatabase(env).then((result) => sendJson(response, 200, result)).catch((error) => sendJson(response, 503, { configured: database.configured, reachable: false, error: error.message || "Database check failed" }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/state") {
    readState(env).then((result) => sendJson(response, 200, result)).catch((error) => sendJson(response, error.status ?? 500, { error: error.message || "State load failed" }));
    return;
  }
  if (request.method === "PUT" && request.url === "/api/state") {
    readJson(request).then((body) => writeState(body, env)).then((result) => sendJson(response, 200, result)).catch((error) => sendJson(response, error.status ?? 500, { error: error.message || "State save failed" }));
    return;
  }
  const evaluationMatch = request.url?.match(/^\/api\/releases\/([^/]+)\/constraint-evaluations$/);
  if (request.method === "POST" && evaluationMatch) {
    readJson(request).then((body) => writeConstraintEvaluations(decodeURIComponent(evaluationMatch[1]), body.evaluations, env)).then((result) => sendJson(response, 200, result)).catch((error) => sendJson(response, error.status ?? 500, { error: error.message || "Constraint evaluation save failed" }));
    return;
  }
  if (request.method === "POST" && request.url === "/api/jev/evaluate-plan") {
    readJson(request).then(evaluateReleasePlan).then((result) => sendJson(response, 200, result)).catch((error) => sendJson(response, error.status ?? 500, { error: error.message || "Jev evaluation failed" }));
    return;
  }
  if (request.method === "POST" && request.url === "/api/jev/review-verification") {
    readJson(request).then(reviewVerification).then((result) => sendJson(response, 200, result)).catch((error) => sendJson(response, error.status ?? 500, { error: error.message || "Jev verification review failed" }));
    return;
  }
  if (request.url?.startsWith("/api/")) {
    sendJson(response, 404, { error: "API endpoint not found" });
    return;
  }
  if (vite) {
    vite.middlewares(request, response, () => sendJson(response, 404, { error: "Not found" }));
    return;
  }
  serveBuiltApp(request, response);
});

server.listen(port, host, () => {
  console.log(`Relay server listening on http://${host}:${port}`);
  console.log(`Jev API key: ${jev.configured ? "configured" : "not configured"}`);
  console.log(`Postgres: ${database.configured ? "configured" : "not configured"}`);
});

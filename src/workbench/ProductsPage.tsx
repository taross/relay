import { useCallback, useEffect, useState, type SubmitEvent as ReactSubmitEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { workbenchApi } from "./api";
import type { Product, ProductDetail } from "./types";
import { FormError, WorkbenchDialog } from "./WorkbenchDialog";

function message(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    workbenchApi.listProducts().then(({ products: loaded }) => setProducts(loaded)).catch((reason: unknown) => setError(message(reason)));
  }, []);
  useEffect(load, [load]);

  return <section className="workbench-view">
    <header className="workbench-heading">
      <div><span className="eyebrow">Software Delivery Workbench</span><h1>Products</h1><p>Plan Feature requirements within a Product boundary.</p></div>
      <button className="primary" onClick={() => setCreating(true)}>Create Product</button>
    </header>
    <FormError message={error} />
    {products.length ? <table className="product-table">
      <thead><tr><th>Product</th><th>Features</th><th>Last updated</th></tr></thead>
      <tbody>{products.map((product) => <tr key={product.id}>
        <td><Link to={`/products/${product.id}`}><b>{product.name}</b><small>{product.description || "No description"}</small></Link></td>
        <td>{product.featureCount}</td>
        <td><time dateTime={product.updatedAt}>{new Date(product.updatedAt).toLocaleString()}</time></td>
      </tr>)}</tbody>
    </table> : null}
    {!products.length && !error ? <p className="workbench-empty">Create a Product to start Feature requirements planning.</p> : null}
    {creating ? <CreateProduct close={() => setCreating(false)} saved={load} /> : null}
  </section>;
}

function CreateProduct({ close, saved }: { close: () => void; saved: () => void }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await workbenchApi.createProduct({ name: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") });
      saved();
      close();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };
  return <WorkbenchDialog title="Create Product" close={close}><form onSubmit={submit}>
    <label>Product name<input autoFocus required name="name" /></label>
    <label>Description<textarea name="description" rows={3} /></label>
    <FormError message={error} />
    <button className="primary save-button" disabled={saving}>{saving ? "Saving…" : "Create Product"}</button>
  </form></WorkbenchDialog>;
}

export function ProductPage() {
  const { productId = "" } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    workbenchApi.getProduct(productId).then(setProduct).catch((reason: unknown) => setError(message(reason)));
  }, [productId]);
  useEffect(load, [load]);

  if (!product) return <section className="workbench-view"><Link to="/products">← Products</Link><FormError message={error} />{!error ? <p>Loading Product…</p> : null}</section>;
  return <section className="workbench-view">
    <nav className="workbench-context" aria-label="Product breadcrumb"><Link to="/products">Products</Link><span aria-hidden="true">/</span><span aria-current="page">{product.name}</span></nav>
    <header className="workbench-heading">
      <div><span className="eyebrow">Product-scoped planning</span><h1>{product.name}</h1><p>{product.description || "No description"}</p></div>
      <button className="primary" onClick={() => setCreating(true)}>Add Feature</button>
    </header>
    <FormError message={error} />
    {product.features.length ? <table className="product-table">
      <thead><tr><th>Feature</th><th>Requirements review</th><th>Last updated</th></tr></thead>
      <tbody>{product.features.map((feature) => <tr key={feature.id}>
        <td><Link to={`/products/${product.id}/features/${feature.id}`}><b>{feature.name}</b><small>{feature.summary || "No summary"}</small></Link></td>
        <td>{feature.reviewState}</td>
        <td><time dateTime={feature.updatedAt}>{new Date(feature.updatedAt).toLocaleString()}</time></td>
      </tr>)}</tbody>
    </table> : null}
    {!product.features.length ? <p className="workbench-empty">Add a Feature to begin Requirements phase work.</p> : null}
    {creating ? <CreateFeature product={product} close={() => setCreating(false)} saved={(featureId) => navigate(`/products/${product.id}/features/${featureId}`)} /> : null}
  </section>;
}

function CreateFeature({ product, close, saved }: { product: ProductDetail; close: () => void; saved: (featureId: string) => void }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const created = await workbenchApi.createFeature(product.id, {
        expectedProductVersion: product.version,
        name: String(form.get("name") ?? ""),
        summary: String(form.get("summary") ?? ""),
      });
      saved(created.id);
      close();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };
  return <WorkbenchDialog title="Add Feature" close={close}><form onSubmit={submit}>
    <label>Feature name<input autoFocus required name="name" /></label>
    <label>Summary<textarea name="summary" rows={3} /></label>
    <FormError message={error} />
    <button className="primary save-button" disabled={saving}>{saving ? "Saving…" : "Add Feature"}</button>
  </form></WorkbenchDialog>;
}

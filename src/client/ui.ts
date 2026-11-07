/** Tiny DOM helpers. No innerHTML anywhere: all text goes in as text, so nothing a player types can run as code. */
export interface ElOptions {
  text?: string;
  className?: string;
  onClick?: () => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: ElOptions = {}, children: Node[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.className) node.className = opts.className;
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  for (const c of children) node.appendChild(c);
  return node;
}

export function render(root: Node): void {
  const app = document.getElementById('app');
  if (app) app.replaceChildren(root);
}

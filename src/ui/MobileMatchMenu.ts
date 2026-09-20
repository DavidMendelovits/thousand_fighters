/** DOM-sized targets stay finger-sized even when the 800px arena scales down. */
export class MobileMatchMenu {
  private root = document.createElement('section');
  private key = '';
  constructor() {
    this.root.className = 'tf-match-menu';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Match menu');
    this.root.hidden = true;
    document.body.append(this.root);
  }
  render(key: string, title: string, detail: string, actions: Array<{ label: string; run: () => void }>): void {
    if (key === this.key) return;
    this.key = key;
    this.root.hidden = !key;
    this.root.replaceChildren();
    if (!key) return;
    const heading = document.createElement('h2'); heading.textContent = title;
    const description = document.createElement('p'); description.textContent = detail;
    this.root.append(heading, description);
    for (const action of actions) {
      const button = document.createElement('button'); button.textContent = action.label;
      button.addEventListener('click', action.run);
      this.root.append(button);
    }
  }
  destroy(): void { this.root.remove(); }
}

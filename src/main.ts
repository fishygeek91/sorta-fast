import "./style.css";

/**
 * Hello-world entry for the Sorta Fast Vite scaffold (issue #1).
 * Real race UI lands in later milestones; this only proves the app boots.
 */
function mountHelloWorld(): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root === null) {
    throw new Error("Missing #app root element in index.html");
  }

  root.innerHTML = `
    <main class="hello">
      <h1>Sorta Fast</h1>
      <p>Shortest paths that only sorta sort.</p>
    </main>
  `;
}

mountHelloWorld();

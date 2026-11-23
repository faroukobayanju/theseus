import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, "index.html");

export function startLegacyTodoServer(port = Number(process.env.PORT || 4201)) {
  const server = createServer(async (req, res) => {
    const urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OK");
      return;
    }
    if (urlPath === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (urlPath === "/" || urlPath === "/index.html") {
      const html = await readFile(INDEX_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4201);
  startLegacyTodoServer(port).then(() => {
    console.log(`Legacy TodoMVC listening on http://127.0.0.1:${port}`);
  });
}

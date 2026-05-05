const esbuild = require("esbuild");

const isWatch = process.argv.includes("--watch");
const isProd = process.argv.includes("--production");

const shared = {
  bundle: true,
  platform: "node",
  target: "node18",
  minify: isProd,
  sourcemap: !isProd,
};

async function build() {
  const extCtx = await esbuild.context({
    ...shared,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    format: "cjs",
    external: ["vscode"],
  });

  const mcpCtx = await esbuild.context({
    ...shared,
    entryPoints: ["src/mcp-server.ts"],
    outfile: "dist/mcp-server.js",
    format: "cjs",
    external: [],
  });

  if (isWatch) {
    await extCtx.watch();
    await mcpCtx.watch();
    console.log("watching...");
  } else {
    await extCtx.rebuild();
    await mcpCtx.rebuild();
    await extCtx.dispose();
    await mcpCtx.dispose();
    console.log("build complete");
  }
}

build().catch(() => process.exit(1));

import express from "express";

const app = express();
const port = Number(process.env.PORT ?? "8080");

async function callExternal(tag: string) {
  const url = "http://httpbin.org/get";
  const r = await fetch(url);
  const txt = await r.text();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ tag, url, status: r.status, bytes: txt.length, ts: new Date().toISOString() }));
}

app.get("/ping", async (_req: any, res: any) => {
  try {
    await callExternal("ping");
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error(`external call failed: ${e?.message ?? String(e)}`);
  }
  res.status(200).send("ok\n");
});

app.get("/", (_req: any, res: any) => res.status(200).send("app-demo\n"));

app.listen(port, "0.0.0.0", async () => {
  // eslint-disable-next-line no-console
  console.log(`app-demo listening on :${port}`);
  try {
    await callExternal("startup");
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error(`startup external call failed: ${e?.message ?? String(e)}`);
  }
});


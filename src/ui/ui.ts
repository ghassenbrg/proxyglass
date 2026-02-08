import { readFileSync } from "node:fs";

export function loadUiHtml(): string {
  return readFileSync(new URL("../../public/ui.html", import.meta.url), "utf8");
}


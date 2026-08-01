#!/usr/bin/env node
/** Clear weekly learning-module topic (server-only — no AAB). Build 49 Learn stops quiz trap. */
import { readFileSync } from "node:fs";

const API =
  "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";
const credentials = readFileSync(
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md",
  "utf8",
);
const adminBlock = credentials.split("## Production mobile app")[0];
const email = adminBlock.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
const password = adminBlock.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();
if (!email || !password) throw new Error("Local admin credentials unavailable");

async function json(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: non-JSON (${response.status})`);
  }
  if (!response.ok || body.type === "Error" || body.type === "error") {
    throw new Error(`${path}: HTTP ${response.status} — ${body.message || "failed"}`);
  }
  return body;
}

const login = await json("/auth/admin-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const token = login?.data?.token || login?.token;
if (!token) throw new Error("Admin login returned no token");

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

const before = await json("/admin/learning-modules/weekly-topic", { headers });
console.log("Before:", JSON.stringify(before.data));

await json("/admin/learning-modules/weekly-topic", {
  method: "PUT",
  headers,
  body: JSON.stringify({ moduleId: null, weeklyTheme: null }),
});

const afterAdmin = await json("/admin/learning-modules/weekly-topic", { headers });

console.log("After admin config:", JSON.stringify(afterAdmin.data));
console.log("Done — build 49 Learn will receive topic:null from weekly-topic API.");

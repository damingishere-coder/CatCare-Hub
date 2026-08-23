import { requestJson } from "../../lib/api";

export interface IntegrationState {
  name: string;
  configured: boolean;
  status: "not_configured" | "configured";
  message: string | null;
}

export interface IntegrationSettings {
  amap_backend: IntegrationState;
  gpt_recommendation: IntegrationState;
}

export interface IntegrationTestResult {
  target: "amap" | "openai";
  connected: boolean;
  message: string;
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const path = `${apiBase}/api/admin/settings/integrations`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(url, init);
}

export function getIntegrationSettings(): Promise<IntegrationSettings> {
  return request<IntegrationSettings>(path);
}

export function testIntegration(target: "amap" | "openai"): Promise<IntegrationTestResult> {
  return request<IntegrationTestResult>(`${path}/test`, {
    method: "POST",
    body: JSON.stringify({ target }),
  });
}

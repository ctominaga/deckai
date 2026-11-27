import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { findPdfBrowser } from "./pdf-renderer.js";

vi.mock("node:fs", () => ({ existsSync: vi.fn(), readdirSync: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("descoberta do navegador PDF", () => {
  it("encontra a versão mais recente do EdgeCore sem uma instalação Edge/Application", () => {
    vi.stubEnv("PDF_BROWSER_PATH", "");
    vi.stubEnv("ProgramFiles(x86)", "C:/Program Files (x86)");
    vi.stubEnv("ProgramFiles", "C:/Program Files");
    vi.mocked(readdirSync).mockReturnValue(["99.0.1.1", "158.0.4370.45", "not-a-version"] as never);
    const expected = "C:\\Program Files (x86)\\Microsoft\\EdgeCore\\158.0.4370.45\\msedge.exe";
    vi.mocked(existsSync).mockImplementation(path => String(path) === expected);
    expect(findPdfBrowser("win32")).toBe(expected);
  });
  it("respeita um executável configurado explicitamente", () => {
    vi.stubEnv("PDF_BROWSER_PATH", "D:/tools/chrome.exe");
    expect(findPdfBrowser("win32")).toBe("D:/tools/chrome.exe");
    expect(readdirSync).not.toHaveBeenCalled();
  });
  it("retorna indisponível quando nenhum executável existe", () => {
    vi.stubEnv("PDF_BROWSER_PATH", "");
    vi.mocked(readdirSync).mockImplementation(() => { throw new Error("ENOENT"); });
    vi.mocked(existsSync).mockReturnValue(false);
    expect(findPdfBrowser("win32")).toBeUndefined();
  });
});

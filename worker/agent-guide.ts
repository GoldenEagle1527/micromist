/**
 * Serves Agent Guides at /agent-guide and /agent-guide/<slug>.
 * Protocol bodies live in docs/; the live host is prepended per request.
 */
import protocolEn from "../docs/agent-ws-explosive-chess.md?raw";
import protocolZh from "../docs/agent-ws-explosive-chess.zh.md?raw";
import chromaEn from "../docs/agent-ws-chroma-slide.md?raw";
import chromaZh from "../docs/agent-ws-chroma-slide.zh.md?raw";
import gomokuEn from "../docs/agent-ws-gomoku.md?raw";
import gomokuZh from "../docs/agent-ws-gomoku.zh.md?raw";
import { agentPlatformHttpResponse } from "../shared/agent/http";

export function handleAgentGuide(request: Request): Response | null {
  return agentPlatformHttpResponse(request, {
    "explosive-chess": { en: protocolEn, zh: protocolZh },
    "chroma-slide": { en: chromaEn, zh: chromaZh },
    gomoku: { en: gomokuEn, zh: gomokuZh },
  });
}

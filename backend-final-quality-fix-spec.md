# Research Studio — Fix final de calidad (cierre de backend)

> **Para Codex**: el backend ya corre real end-to-end contra GitHub Models.
> Este es el último ajuste de calidad: migrar la librería de búsqueda deprecada
> a `ddgs`, dar más iteraciones al subagente, y reforzar el prompt de fetch.
> Cambios en `pyproject.toml`, `web_search.py`, `config.py`, `subagent.py`.
> Reglas de siempre: NO crear stubs ni mocks; reportar errores reales tal cual.

---

## 1. Diagnóstico (del último run real)

- `duckduckgo_search` está deprecada (warning en el log: "renamed to ddgs").
  Devuelve resultados vía Bing que pueden venir pobres o con keys distintas,
  dejando al subagente sin buenas URLs para fetchear.
- `max_subagent_iterations=3` es muy poco para el flujo buscar → fetchear →
  concluir. Los subagentes agotan iteraciones y cierran con
  `(max iterations reached)` sin findings reales.

---

## 2. Paso 1 — Migrar a `ddgs`

### 2.1 pyproject.toml

En `backend/pyproject.toml`, en `dependencies`, reemplazá la línea:
```toml
    "duckduckgo-search>=6.3",
```
por:
```toml
    "ddgs>=6.0",
```

Reinstalar:
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip uninstall -y duckduckgo-search
pip install -e ".[dev]"
```

### 2.2 web_search.py

Reemplazá el contenido completo de
`backend/src/research_studio/tools/web_search.py`:

```python
"""Web search tool using the ddgs library (no API key required)."""

import asyncio
from typing import Any

from ddgs import DDGS

WEB_SEARCH_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web for relevant information about a query. Returns up "
            "to 6 results with title, URL, and snippet. Use to DISCOVER sources."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query. Be specific and keyword-driven.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (1-6).",
                    "minimum": 1,
                    "maximum": 6,
                    "default": 6,
                },
            },
            "required": ["query"],
        },
    },
}


async def run_web_search(query: str, max_results: int = 6) -> list[dict[str, str]]:
    def _search_sync() -> list[dict[str, str]]:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        out: list[dict[str, str]] = []
        for r in results:
            # Defensive: handle key variations across ddgs versions.
            out.append(
                {
                    "title": r.get("title", ""),
                    "url": r.get("href") or r.get("url", ""),
                    "snippet": r.get("body") or r.get("snippet", ""),
                }
            )
        return out

    return await asyncio.to_thread(_search_sync)
```

> NOTA Codex: si `ddgs.text(query, max_results=...)` lanza un TypeError por
> firma distinta en la versión instalada, probá `ddgs.text(query=query,
> max_results=max_results)` o revisá la firma con `python -c "from ddgs import
> DDGS; help(DDGS.text)"` y adaptá SOLO esa llamada. No cambies nada más.
> Reportá la firma real si tuviste que ajustarla.

---

## 3. Paso 2 — Subir límites en config.py

En `backend/src/research_studio/config.py`, cambiá estas dos líneas:

```python
    max_subagent_iterations: int = 3
    max_subquestions: int = 2
```
por:
```python
    max_subagent_iterations: int = 5
    max_subquestions: int = 3
```

Esto le da al subagente margen para buscar, fetchear una o dos fuentes, y
recién concluir; y produce un reporte con 3 secciones en vez de 2.

---

## 4. Paso 3 — Reforzar el prompt del subagente

En `backend/src/research_studio/agents/subagent.py`, reemplazá
`SUBAGENT_SYSTEM_PROMPT` por:

```python
SUBAGENT_SYSTEM_PROMPT = """You are a research subagent investigating ONE specific \
subquestion. You have two tools:
- `web_search(query)`: returns search results (title, URL, snippet).
- `web_fetch(url)`: returns the full text of a page.

Follow this exact procedure:
1. Call web_search once for the subquestion.
2. Look at the returned URLs. Immediately call web_fetch on the single most \
relevant URL to read it in full. This step is REQUIRED — do not skip it.
3. If that fetch returns an error (403, empty, etc.), call web_fetch on the NEXT \
most relevant URL. Try up to 2-3 different URLs before giving up on fetching.
4. Write your findings using BOTH the fetched content (preferred) and the search \
snippets (as backup). Your findings must:
   - Directly answer the subquestion
   - Cite the specific source URLs you actually used, inline
   - Be honest if you could only rely on snippets because fetches failed
5. Keep the final answer under 350 words.

Important: you have a limited number of tool calls. Do not search repeatedly \
without fetching — search once, then fetch. End the turn with your findings text."""
```

Cambio clave: lo obliga a buscar UNA vez y después fetchear, en vez de
malgastar iteraciones buscando una y otra vez.

---

## 5. Paso 4 — Correr y pegar datos crudos

Liberá el puerto 8000 si hace falta, reiniciá el backend, y corré el harness:

```powershell
# matar backend viejo si sigue arriba
netstat -ano | findstr :8000
# taskkill /PID <pid> /F   (si aparece)

cd backend
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH='src'
python -m uvicorn research_studio.main:app --host 127.0.0.1 --port 8000
```

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python run_capture.py
```

Pegá crudo (sin resumir):
1. El bloque SUMMARY completo.
2. El `run_report.json` entero.
3. Las líneas del log con `web_fetch`, `403`, `models.github.ai`, o `WARNING`.

Lo que esperamos ver mejorado:
- `web_fetch` con número > 0 en los tool calls
- Findings reales (no `max iterations reached`)
- Idealmente `citations` > 0 con URLs reales
- Ya NO el warning de `duckduckgo_search renamed`

---

## 6. Paso 5 — Commit

```powershell
cd "D:\CIBER !!!!\Estudio\CURSOS\Udemy - AI Mastery 150+ Projects, AI Algorithms, DeepSeek AI Agents 2025-3\Portafolio\research-studio"
git add -A
git commit -m "backend quality: migrate to ddgs, more iterations, stronger fetch prompt"
git log --oneline -n 5
```

Pegá la salida de `git log --oneline`. NO toques el snapshot `9f77178`.

---

## 7. Expectativa realista (importante)

Con `gpt-4o-mini` en free tier, la calidad de research va a ser DECENTE, no
excelente — es un modelo chico. Puede que algún fetch siga fallando por
Cloudflare y que las citations sean pocas. **Eso está bien para cerrar el
backend**: lo que importa es que el flujo completo funcione y produzca un
reporte con fuentes reales cuando los sitios lo permiten. El día que conectes
un modelo más potente (cambiando solo el `.env`), la calidad sube sin tocar
código. No persigas perfección acá — con que veas web_fetch funcionando y
algún citation real, cerramos y pasamos al frontend.

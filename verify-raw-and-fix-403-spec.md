# Research Studio — Verificación cruda + fix de 403 en web_fetch

> **Para Codex**: dos tareas. Primero (PASO 1) pegá datos crudos sin resumir
> para verificar que el sistema corre contra la API real. Segundo (PASO 2)
> aplicá un fix chico al `web_fetch` para los 403. Después un commit.

---

## PASO 1 — Pegá estos datos crudos, SIN resumir ni interpretar

No describas, no resumas, no parafrasees. Pegá el contenido literal de cada
cosa, entre bloques de código:

**1.1** El bloque SUMMARY completo que imprime `run_capture.py` (todo lo que
está entre las líneas de `=====`, incluyendo los conteos de cada tipo de
evento, subagents, tool calls y citations).

**1.2** El contenido ENTERO del archivo `backend/run_report.json`. Abrilo y
pegalo completo, tal cual está.

**1.3** Las líneas del log de uvicorn (la terminal del backend) que contengan
peticiones HTTP. Filtralas y pegalas. En PowerShell, si tenés el log en un
archivo, podés hacer:
```powershell
# si redirigiste el log a un archivo; si no, copiá las lineas a mano de la terminal
Select-String -Path uvicorn.log -Pattern "HTTP Request|models.github.ai|web_fetch|403|429|WARNING" 
```
Si el log solo está en la terminal, copiá a mano todas las líneas que tengan
`HTTP Request`, `models.github.ai`, `403`, `429`, o `WARNING`.

Necesito ver específicamente:
- Si hay líneas `POST https://models.github.ai/...` (prueba que le pega a la API real)
- Los `web_fetch` que dieron `403`
- Cualquier `WARNING` (rate limit, fallback, o `LLM synthesis failed`)

---

## PASO 2 — Fix de los 403 en `web_fetch`

Muchos sitios bloquean requests con User-Agent no-navegador. Reemplazá el
bloque de headers del cliente httpx en
`backend/src/research_studio/tools/web_fetch.py`.

Buscá esto:
```python
        async with httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": "ResearchStudio/0.2"},
            follow_redirects=True,
        ) as client:
```

Reemplazalo por esto:
```python
        async with httpx.AsyncClient(
            timeout=15.0,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;q=0.9,"
                    "image/avif,image/webp,*/*;q=0.8"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            },
            follow_redirects=True,
        ) as client:
```

Esto hace que el fetch se presente como un navegador real. No va a resolver el
100% de los sitios (algunos usan Cloudflare u otras protecciones más fuertes),
pero baja bastante la tasa de 403. Los que sigan fallando, el subagente los ve
como error y sigue con otra fuente — comportamiento ya correcto.

---

## PASO 3 — Volver a correr el harness

Reiniciá el backend (si está corriendo, matá el proceso del puerto 8000
primero) y corré `run_capture.py` de nuevo:

```powershell
# liberar puerto si hace falta
netstat -ano | findstr :8000
# taskkill /PID <pid> /F   (si aparece algo)

# terminal backend
cd backend
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH='src'
python -m uvicorn research_studio.main:app --host 127.0.0.1 --port 8000
```

```powershell
# otra terminal
cd backend
.\.venv\Scripts\Activate.ps1
python run_capture.py
```

Después de esta segunda corrida, pegá OTRA VEZ los tres datos crudos del
PASO 1 (SUMMARY, run_report.json, líneas HTTP del log). Quiero comparar
cuántos fetch pasan ahora vs antes.

---

## PASO 4 — Commit (NO limpiar el snapshot todavía)

Una vez que tengas la corrida con el fix aplicado, commiteá:

```powershell
cd "D:\CIBER !!!!\Estudio\CURSOS\Udemy - AI Mastery 150+ Projects, AI Algorithms, DeepSeek AI Agents 2025-3\Portafolio\research-studio"
git add -A
git commit -m "fix web_fetch user-agent (reduce 403s)"
git log --oneline
```

Pegá la salida de `git log --oneline`.

**NO borres ni reescribas el commit del snapshot inicial** (`9f77178`). Ese es
la red de seguridad hasta que confirmemos que todo quedó bien. Se limpia al
final, no ahora.

---

## Recordatorio importante

NO resumas los resultados con tus palabras. Pegá los datos crudos. Si algo
falla contra la API real, pegá el error tal cual — no reemplaces módulos ni
crees mocks para que el test pase.

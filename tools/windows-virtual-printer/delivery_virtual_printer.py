#!/usr/bin/env python3
"""
Delivery Platform Windows Virtual Printer
Version 0.8.0

Creates a Windows printer queue backed by the built-in Microsoft Print To PDF
driver, silently captures PDFs to a local spool file, and uploads completed
jobs to the Delivery Platform /api/ingest/pdf endpoint.

Build with PyInstaller using build_exe.bat.
Run the resulting EXE as Administrator.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import datetime as dt
import json
import logging
import mimetypes
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from ctypes import wintypes
from pathlib import Path
from typing import Optional

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

APP_NAME = "Delivery Platform Virtual Printer"
VERSION = "0.8.0"
APP_DIR_NAME = "DeliveryPrinter"
TASK_NAME = "Delivery Platform Print Agent"

PROGRAM_DATA = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / APP_DIR_NAME
PROGRAM_FILES = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / APP_DIR_NAME
CONFIG_PATH = PROGRAM_DATA / "config.json"
LOG_DIR = PROGRAM_DATA / "Logs"
LOG_PATH = LOG_DIR / "agent.log"
SPOOL_DIR = PROGRAM_DATA / "Spool"
PENDING_DIR = PROGRAM_DATA / "Pending"
ARCHIVE_DIR = PROGRAM_DATA / "Archive"
FAILED_DIR = PROGRAM_DATA / "Failed"
SPOOL_FILE = SPOOL_DIR / "delivery-current.pdf"

DEFAULTS = {
    "printer_name": "Delivery Platform Printer",
    "api_base": "https://delivery.example.com",
    "organization_id": "",
    "upload_endpoint": "/api/ingest/pdf",
    "start_with_windows": True,
    "start_after_install": True,
    "retry_seconds": 30,
    "stable_seconds": 1.25,
    "request_timeout_seconds": 60,
}

# ---------------------------------------------------------------------------
# Windows DPAPI helpers
# ---------------------------------------------------------------------------

class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]

def _blob_from_bytes(data: bytes):
    buf = ctypes.create_string_buffer(data)
    blob = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    return blob, buf

def dpapi_protect(text: str) -> str:
    data_blob, _ = _blob_from_bytes(text.encode("utf-8"))
    out_blob = DATA_BLOB()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptProtectData(
        ctypes.byref(data_blob),
        "Delivery Platform Print Agent",
        None,
        None,
        None,
        0,
        ctypes.byref(out_blob),
    ):
        raise ctypes.WinError()
    try:
        protected = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        return base64.b64encode(protected).decode("ascii")
    finally:
        kernel32.LocalFree(out_blob.pbData)

def dpapi_unprotect(encoded: str) -> str:
    if not encoded:
        return ""
    raw = base64.b64decode(encoded)
    data_blob, _ = _blob_from_bytes(raw)
    out_blob = DATA_BLOB()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptUnprotectData(
        ctypes.byref(data_blob),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(out_blob),
    ):
        raise ctypes.WinError()
    try:
        clear = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        return clear.decode("utf-8")
    finally:
        kernel32.LocalFree(out_blob.pbData)

# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------

def ensure_dirs() -> None:
    for p in [PROGRAM_DATA, PROGRAM_FILES, LOG_DIR, SPOOL_DIR, PENDING_DIR, ARCHIVE_DIR, FAILED_DIR]:
        p.mkdir(parents=True, exist_ok=True)

def setup_logging() -> None:
    ensure_dirs()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )

def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False

def current_command(args: list[str]) -> tuple[str, str]:
    if getattr(sys, "frozen", False):
        return sys.executable, subprocess.list2cmdline(args)
    params = [str(Path(__file__).resolve())] + args
    return sys.executable, subprocess.list2cmdline(params)

def relaunch_elevated() -> bool:
    if is_admin():
        return True
    exe, params = current_command(sys.argv[1:])
    result = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, params, None, 1)
    return result > 32

def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"

def powershell(script: str, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if check and proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "PowerShell failed")
    return proc

def load_config() -> dict:
    cfg = DEFAULTS.copy()
    if CONFIG_PATH.exists():
        try:
            stored = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            cfg.update({k: v for k, v in stored.items() if k != "token_encrypted"})
            cfg["token_encrypted"] = stored.get("token_encrypted", "")
        except Exception:
            cfg["token_encrypted"] = ""
    else:
        cfg["token_encrypted"] = ""
    return cfg

def get_token(cfg: dict) -> str:
    try:
        return dpapi_unprotect(cfg.get("token_encrypted", ""))
    except Exception:
        return ""

def save_config(cfg: dict, token: Optional[str] = None) -> None:
    ensure_dirs()
    stored = dict(cfg)
    if token is not None:
        stored["token_encrypted"] = dpapi_protect(token)
    elif "token_encrypted" not in stored:
        old = load_config()
        stored["token_encrypted"] = old.get("token_encrypted", "")
    tmp = CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(stored, indent=2), encoding="utf-8")
    tmp.replace(CONFIG_PATH)

def installed_binary() -> Path:
    return PROGRAM_FILES / ("DeliveryPrinter.exe" if getattr(sys, "frozen", False) else "delivery_virtual_printer.py")

def copy_self() -> Path:
    ensure_dirs()
    src = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve()
    dst = installed_binary()
    if src != dst:
        shutil.copy2(src, dst)
    return dst

def installed_agent_command() -> str:
    exe = PROGRAM_FILES / "DeliveryPrinter.exe"
    if exe.exists():
        return subprocess.list2cmdline([str(exe), "--agent"])
    script = PROGRAM_FILES / "delivery_virtual_printer.py"
    return subprocess.list2cmdline([sys.executable, str(script), "--agent"])

# ---------------------------------------------------------------------------
# Printer setup
# ---------------------------------------------------------------------------

def ensure_pdf_driver() -> None:
    result = powershell(
        "Get-PrinterDriver -Name 'Microsoft Print To PDF' -ErrorAction SilentlyContinue | "
        "Select-Object -ExpandProperty Name",
        check=False,
    )
    if "Microsoft Print To PDF" in result.stdout:
        return

    subprocess.run(
        [
            "dism.exe",
            "/Online",
            "/Enable-Feature",
            "/FeatureName:Printing-PrintToPDFServices-Features",
            "/NoRestart",
        ],
        capture_output=True,
        text=True,
    )
    time.sleep(2)

    result = powershell(
        "Get-PrinterDriver -Name 'Microsoft Print To PDF' -ErrorAction SilentlyContinue | "
        "Select-Object -ExpandProperty Name",
        check=False,
    )
    if "Microsoft Print To PDF" not in result.stdout:
        raise RuntimeError("Microsoft Print To PDF is not available on this PC.")

def install_printer(printer_name: str) -> None:
    ensure_pdf_driver()
    ensure_dirs()
    port_name = str(SPOOL_FILE)

    powershell(f"""
$ErrorActionPreference = 'Stop'
$printerName = {ps_quote(printer_name)}
$portName = {ps_quote(port_name)}

$p = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if ($p) {{
    Remove-Printer -Name $printerName
    Start-Sleep -Milliseconds 400
}}

$port = Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue
if (-not $port) {{
    Add-PrinterPort -Name $portName
}}

Add-Printer -Name $printerName -DriverName 'Microsoft Print To PDF' -PortName $portName
""")

def uninstall_printer(printer_name: str) -> None:
    port_name = str(SPOOL_FILE)
    powershell(f"""
$printerName = {ps_quote(printer_name)}
$portName = {ps_quote(port_name)}
$p = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if ($p) {{ Remove-Printer -Name $printerName -ErrorAction SilentlyContinue }}
Start-Sleep -Milliseconds 300
$port = Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue
if ($port) {{ Remove-PrinterPort -Name $portName -ErrorAction SilentlyContinue }}
""", check=False)

def configure_startup(enabled: bool) -> None:
    subprocess.run(
        ["schtasks.exe", "/Delete", "/TN", TASK_NAME, "/F"],
        capture_output=True,
        text=True,
    )
    if not enabled:
        return

    command = installed_agent_command()
    proc = subprocess.run(
        [
            "schtasks.exe",
            "/Create",
            "/TN",
            TASK_NAME,
            "/TR",
            command,
            "/SC",
            "ONLOGON",
            "/RL",
            "HIGHEST",
            "/F",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())

def start_agent() -> None:
    subprocess.Popen(
        installed_agent_command(),
        shell=True,
        creationflags=(
            getattr(subprocess, "DETACHED_PROCESS", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        ),
        close_fds=True,
    )

def stop_agent() -> None:
    exe = PROGRAM_FILES / "DeliveryPrinter.exe"
    if exe.exists():
        powershell(
            "Get-CimInstance Win32_Process | "
            f"Where-Object {{$_.ExecutablePath -eq {ps_quote(str(exe))} -and $_.CommandLine -match '--agent'}} | "
            "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
            check=False,
        )

# ---------------------------------------------------------------------------
# HTTP upload
# ---------------------------------------------------------------------------

def multipart_body(fields: dict[str, str], file_path: Path) -> tuple[str, bytes]:
    boundary = "----DeliveryPlatform" + uuid.uuid4().hex
    parts: list[bytes] = []

    for name, value in fields.items():
        parts.extend([
            f"--{boundary}".encode(),
            f'Content-Disposition: form-data; name="{name}"'.encode(),
            b"",
            value.encode("utf-8"),
        ])

    mime = mimetypes.guess_type(file_path.name)[0] or "application/pdf"
    parts.extend([
        f"--{boundary}".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"'.encode(),
        f"Content-Type: {mime}".encode(),
        b"",
        file_path.read_bytes(),
        f"--{boundary}--".encode(),
        b"",
    ])

    return boundary, b"\r\n".join(parts)

def upload_pdf(path: Path, cfg: dict) -> tuple[bool, str]:
    token = get_token(cfg)
    if not token:
        return False, "Print Agent token is not configured"

    base = str(cfg["api_base"]).rstrip("/")
    endpoint = str(cfg.get("upload_endpoint", "/api/ingest/pdf"))
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    url = base + endpoint

    boundary, body = multipart_body(
        {
            "organizationId": str(cfg["organization_id"]),
            "source": "PRINT_AGENT",
        },
        path,
    )

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Organization-ID": str(cfg["organization_id"]),
            "X-Ingest-Source": "PRINT_AGENT",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
            "User-Agent": f"DeliveryPrinter/{VERSION}",
        },
    )

    try:
        with urllib.request.urlopen(
            req,
            timeout=int(cfg.get("request_timeout_seconds", 60)),
        ) as response:
            data = response.read().decode("utf-8", errors="replace")
            return 200 <= response.status < 300, data
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return False, f"HTTP {exc.code}: {body}"
    except Exception as exc:
        return False, str(exc)

def test_connection(cfg: dict) -> tuple[bool, str]:
    base = str(cfg["api_base"]).rstrip("/")
    try:
        req = urllib.request.Request(base + "/health", method="GET")
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status == 200, f"HTTP {response.status}"
    except Exception as exc:
        return False, str(exc)

# ---------------------------------------------------------------------------
# Background agent
# ---------------------------------------------------------------------------

def unique_pending_path() -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    return PENDING_DIR / f"delivery-{stamp}-{uuid.uuid4().hex[:8]}.pdf"

def is_pdf(path: Path) -> bool:
    try:
        with path.open("rb") as fh:
            return fh.read(5) == b"%PDF-"
    except Exception:
        return False

def stage_spool(cfg: dict, state: dict) -> None:
    if not SPOOL_FILE.exists():
        state.clear()
        return

    try:
        stat = SPOOL_FILE.stat()
    except FileNotFoundError:
        state.clear()
        return

    signature = (stat.st_size, stat.st_mtime_ns)
    now = time.monotonic()
    if state.get("signature") != signature:
        state["signature"] = signature
        state["stable_since"] = now
        return

    if now - state.get("stable_since", now) < float(cfg.get("stable_seconds", 1.25)):
        return

    if stat.st_size < 100 or not is_pdf(SPOOL_FILE):
        return

    target = unique_pending_path()
    try:
        os.replace(SPOOL_FILE, target)
        logging.info("Captured print job %s", target.name)
        state.clear()
    except PermissionError:
        return

def process_pending(cfg: dict, retry_after: dict[str, float]) -> None:
    now = time.monotonic()
    for pdf in sorted(PENDING_DIR.glob("*.pdf")):
        key = str(pdf)
        if now < retry_after.get(key, 0):
            continue

        ok, detail = upload_pdf(pdf, cfg)
        if ok:
            target = ARCHIVE_DIR / pdf.name
            shutil.move(str(pdf), str(target))
            retry_after.pop(key, None)
            logging.info("Uploaded %s: %s", target.name, detail[:800])
        else:
            retry_after[key] = now + int(cfg.get("retry_seconds", 30))
            logging.warning("Upload failed for %s: %s", pdf.name, detail)

def run_agent() -> None:
    setup_logging()
    ensure_dirs()
    state: dict = {}
    retry_after: dict[str, float] = {}

    logging.info("Delivery Printer agent %s started", VERSION)

    while True:
        try:
            cfg = load_config()
            stage_spool(cfg, state)
            process_pending(cfg, retry_after)
        except KeyboardInterrupt:
            break
        except Exception:
            logging.exception("Agent loop failure")
        time.sleep(0.25)

# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

class InstallerWindow:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(f"{APP_NAME} {VERSION}")
        self.root.geometry("740x600")
        self.root.minsize(680, 560)

        cfg = load_config()
        self.printer_name = tk.StringVar(value=cfg.get("printer_name", DEFAULTS["printer_name"]))
        self.api_base = tk.StringVar(value=cfg.get("api_base", DEFAULTS["api_base"]))
        self.organization_id = tk.StringVar(value=cfg.get("organization_id", ""))
        self.token = tk.StringVar(value=get_token(cfg))
        self.start_windows = tk.BooleanVar(value=bool(cfg.get("start_with_windows", True)))
        self.start_now = tk.BooleanVar(value=bool(cfg.get("start_after_install", True)))
        self.status = tk.StringVar(value="Ready")

        self.build()

    def build(self):
        outer = ttk.Frame(self.root, padding=18)
        outer.pack(fill="both", expand=True)

        ttk.Label(
            outer,
            text="Delivery Platform Virtual Printer",
            font=("Segoe UI", 18, "bold"),
        ).grid(row=0, column=0, columnspan=2, sticky="w")

        ttk.Label(
            outer,
            text=(
                "Creates a Windows printer that silently captures delivery receipts "
                "and uploads them to the Delivery Platform."
            ),
            wraplength=680,
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(4, 18))

        fields = [
            ("Virtual printer name", self.printer_name),
            ("Delivery Platform URL", self.api_base),
            ("Organization ID", self.organization_id),
        ]

        row = 2
        for label, variable in fields:
            ttk.Label(outer, text=label).grid(row=row, column=0, sticky="w", pady=7)
            ttk.Entry(outer, textvariable=variable, width=54).grid(row=row, column=1, sticky="ew", pady=7)
            row += 1

        ttk.Label(outer, text="Print Agent token").grid(row=row, column=0, sticky="w", pady=7)
        ttk.Entry(outer, textvariable=self.token, width=54, show="•").grid(row=row, column=1, sticky="ew", pady=7)
        row += 1

        ttk.Checkbutton(
            outer,
            text="Start Print Agent with Windows",
            variable=self.start_windows,
        ).grid(row=row, column=1, sticky="w", pady=6)
        row += 1

        ttk.Checkbutton(
            outer,
            text="Start Print Agent immediately after install/update",
            variable=self.start_now,
        ).grid(row=row, column=1, sticky="w", pady=6)
        row += 1

        ttk.Separator(outer).grid(row=row, column=0, columnspan=2, sticky="ew", pady=14)
        row += 1

        buttons = ttk.Frame(outer)
        buttons.grid(row=row, column=0, columnspan=2, sticky="ew")
        ttk.Button(buttons, text="Install / Update", command=self.install).pack(side="left", padx=(0, 8))
        ttk.Button(buttons, text="Test API", command=self.test_api).pack(side="left", padx=(0, 8))
        ttk.Button(buttons, text="Open Archive", command=self.open_archive).pack(side="left", padx=(0, 8))
        ttk.Button(buttons, text="Open Log", command=self.open_log).pack(side="left", padx=(0, 8))
        ttk.Button(buttons, text="Uninstall", command=self.uninstall).pack(side="right")
        row += 1

        status_frame = ttk.LabelFrame(outer, text="Status")
        status_frame.grid(row=row, column=0, columnspan=2, sticky="nsew", pady=(18, 0))
        ttk.Label(status_frame, textvariable=self.status, wraplength=650).pack(fill="x", padx=10, pady=10)

        outer.columnconfigure(1, weight=1)
        outer.rowconfigure(row, weight=1)

    def collected(self) -> tuple[dict, str]:
        cfg = load_config()
        cfg.update({
            "printer_name": self.printer_name.get().strip() or DEFAULTS["printer_name"],
            "api_base": self.api_base.get().strip().rstrip("/"),
            "organization_id": self.organization_id.get().strip(),
            "start_with_windows": bool(self.start_windows.get()),
            "start_after_install": bool(self.start_now.get()),
            "upload_endpoint": "/api/ingest/pdf",
        })
        return cfg, self.token.get().strip()

    def set_status(self, value: str):
        self.status.set(value)
        self.root.update_idletasks()

    def install(self):
        def worker():
            try:
                cfg, token = self.collected()
                if not cfg["api_base"]:
                    raise ValueError("Delivery Platform URL is required.")
                if not cfg["organization_id"]:
                    raise ValueError("Organization ID is required.")
                if not token:
                    raise ValueError("Print Agent token is required.")

                self.set_status("Saving secure configuration...")
                save_config(cfg, token)

                self.set_status("Copying installed application...")
                copy_self()

                self.set_status("Creating Windows virtual printer...")
                install_printer(cfg["printer_name"])

                self.set_status("Configuring Windows startup...")
                configure_startup(cfg["start_with_windows"])

                if cfg["start_after_install"]:
                    self.set_status("Starting Print Agent...")
                    stop_agent()
                    time.sleep(0.3)
                    start_agent()

                self.set_status(
                    f"Installed successfully.\nPrinter: {cfg['printer_name']}\n"
                    "The pharmacy software can now print directly to this queue."
                )
                messagebox.showinfo(APP_NAME, f"Installed successfully.\n\nPrinter: {cfg['printer_name']}")
            except Exception as exc:
                logging.exception("Installation failed")
                self.set_status(f"Installation failed: {exc}")
                messagebox.showerror(APP_NAME, str(exc))

        threading.Thread(target=worker, daemon=True).start()

    def test_api(self):
        def worker():
            cfg, token = self.collected()
            save_config(cfg, token)
            self.set_status("Testing API...")
            ok, detail = test_connection(cfg)
            if ok:
                self.set_status("API is reachable: " + detail)
                messagebox.showinfo(APP_NAME, "Delivery Platform API is reachable.")
            else:
                self.set_status("API test failed: " + detail)
                messagebox.showerror(APP_NAME, detail)

        threading.Thread(target=worker, daemon=True).start()

    def uninstall(self):
        if not messagebox.askyesno(
            APP_NAME,
            "Remove the virtual printer and startup task?\n\nArchived PDFs will not be deleted.",
        ):
            return

        def worker():
            try:
                cfg, _ = self.collected()
                stop_agent()
                configure_startup(False)
                uninstall_printer(cfg["printer_name"])
                self.set_status("Virtual printer removed. Archive retained.")
                messagebox.showinfo(APP_NAME, "Virtual printer removed.")
            except Exception as exc:
                self.set_status(f"Uninstall failed: {exc}")
                messagebox.showerror(APP_NAME, str(exc))

        threading.Thread(target=worker, daemon=True).start()

    def open_archive(self):
        ensure_dirs()
        os.startfile(str(ARCHIVE_DIR))

    def open_log(self):
        ensure_dirs()
        if not LOG_PATH.exists():
            LOG_PATH.touch()
        os.startfile(str(LOG_PATH))

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", action="store_true")
    args = parser.parse_args()

    if os.name != "nt":
        print("Windows only.")
        return 2

    if args.agent:
        run_agent()
        return 0

    if not is_admin():
        if not relaunch_elevated():
            messagebox.showerror(APP_NAME, "Administrator permission is required.")
        return 0

    setup_logging()
    root = tk.Tk()
    try:
        style = ttk.Style(root)
        if "vista" in style.theme_names():
            style.theme_use("vista")
    except Exception:
        pass
    InstallerWindow(root)
    root.mainloop()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

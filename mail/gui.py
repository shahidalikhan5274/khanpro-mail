"""
Desktop UI — channel search + video crawl (polished layout).
Chalane ke liye: python gui.py
Theme: pip install sv-ttk (na ho to default ttk).
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import webbrowser
import tkinter as tk
import tkinter.font as tkfont
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

import crawler
from youtube_api_pool import YouTubeApiPool, quota_summary_text, quota_warning

try:
    import sv_ttk

    _HAS_SV = True
except ImportError:
    _HAS_SV = False

# YouTube-style accent (header stripe + primary actions)
_ACCENT = "#ff0033"
_BG_HEADER = "#0d0d12"
_BG_HEADER_SUB = "#6b6b78"
_FONT_UI = "Segoe UI"


def _apply_theme(root: tk.Tk) -> None:
    if _HAS_SV:
        sv_ttk.set_theme("dark")
        return
    style = ttk.Style(root)
    if sys.platform == "win32" and "vista" in style.theme_names():
        style.theme_use("vista")


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("YouTube Crowler")
        self.geometry("1024x720")
        self.minsize(880, 600)

        _apply_theme(self)
        self._configure_fonts()

        self._build_header()
        self._body = ttk.Frame(self, padding=(16, 12, 16, 16))
        self._body.pack(fill=tk.BOTH, expand=True)

        nb = ttk.Notebook(self._body)
        nb.pack(fill=tk.BOTH, expand=True)

        self._build_search_tab(nb)
        self._build_crawl_tab(nb)

        self._search_rows: list[dict[str, Any]] = []
        self._crawl_rows: list[dict[str, Any]] = []

    def _configure_fonts(self) -> None:
        try:
            base = tkfont.nametofont("TkDefaultFont")
            base.configure(family=_FONT_UI, size=10)
            txt = tkfont.nametofont("TkTextFont")
            txt.configure(family=_FONT_UI, size=10)
            fix = tkfont.nametofont("TkFixedFont")
            fix.configure(family="Consolas", size=9)
        except tk.TclError:
            pass

    def _build_header(self) -> None:
        outer = tk.Frame(self, bg=_BG_HEADER, highlightthickness=0)
        outer.pack(fill=tk.X)
        stripe = tk.Frame(outer, bg=_ACCENT, height=3, highlightthickness=0)
        stripe.pack(fill=tk.X)
        inner = tk.Frame(outer, bg=_BG_HEADER, highlightthickness=0)
        inner.pack(fill=tk.X, padx=20, pady=(16, 14))
        tk.Label(
            inner,
            text="YouTube Crowler",
            font=(_FONT_UI, 22, "bold"),
            fg="#f2f2f4",
            bg=_BG_HEADER,
        ).pack(anchor=tk.W)
        tk.Label(
            inner,
            text="Professional channel search · video metadata · export CSV / JSON",
            font=(_FONT_UI, 11),
            fg=_BG_HEADER_SUB,
            bg=_BG_HEADER,
        ).pack(anchor=tk.W, pady=(4, 0))
        if not _HAS_SV:
            tk.Label(
                inner,
                text="Tip: pip install sv-ttk — zyada khubsurat dark theme ke liye",
                font=(_FONT_UI, 9),
                fg="#555560",
                bg=_BG_HEADER,
            ).pack(anchor=tk.W, pady=(8, 0))

    def _section(self, parent: ttk.Widget, title: str) -> ttk.LabelFrame:
        f = ttk.LabelFrame(parent, text=f"  {title}  ", padding=12)
        return f

    def _scrollable_sidebar(self, parent: ttk.Widget) -> ttk.Frame:
        """Neeche ke controls tak scroll (mouse wheel + scrollbar)."""
        outer = ttk.Frame(parent, padding=(0, 0, 16, 0))
        outer.pack(side=tk.LEFT, fill=tk.BOTH, expand=False)
        canvas = tk.Canvas(outer, highlightthickness=0, borderwidth=0, width=400)
        vsb = ttk.Scrollbar(outer, orient=tk.VERTICAL, command=canvas.yview)
        canvas.configure(yscrollcommand=vsb.set)
        inner = ttk.Frame(canvas)
        inner_id = canvas.create_window((0, 0), window=inner, anchor=tk.NW)

        def _on_inner_configure(_event=None):
            canvas.configure(scrollregion=canvas.bbox("all"))

        def _on_canvas_configure(event):
            w = max(int(event.width), 1)
            canvas.itemconfigure(inner_id, width=w)

        inner.bind("<Configure>", lambda e: _on_inner_configure())
        canvas.bind("<Configure>", _on_canvas_configure)

        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)

        def _wheel(event):
            w = event.widget
            if isinstance(w, tk.Text):
                return
            if getattr(event, "delta", 0):
                canvas.yview_scroll(int(-event.delta / 120), "units")

        def _wheel_up(_event):
            canvas.yview_scroll(-3, "units")

        def _wheel_down(_event):
            canvas.yview_scroll(3, "units")

        def _bind_wheel(_e=None):
            if sys.platform == "win32" or sys.platform == "darwin":
                canvas.bind_all("<MouseWheel>", _wheel)
            else:
                canvas.bind_all("<Button-4>", _wheel_up)
                canvas.bind_all("<Button-5>", _wheel_down)

        def _unbind_wheel(_e=None):
            if sys.platform == "win32" or sys.platform == "darwin":
                canvas.unbind_all("<MouseWheel>")
            else:
                canvas.unbind_all("<Button-4>")
                canvas.unbind_all("<Button-5>")

        outer.bind("<Enter>", _bind_wheel)
        outer.bind("<Leave>", _unbind_wheel)

        return inner

    def _build_search_tab(self, nb: ttk.Notebook) -> None:
        tab = ttk.Frame(nb, padding=4)
        nb.add(tab, text="  Channel search  ")

        split = ttk.Frame(tab)
        split.pack(fill=tk.BOTH, expand=True)

        left = self._scrollable_sidebar(split)
        right = ttk.Frame(split)
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # —— Left column ——
        mode_fr = self._section(left, "Data source")
        mode_fr.pack(fill=tk.X, pady=(0, 10))
        self.search_mode = tk.StringVar(value="api")
        ttk.Radiobutton(
            mode_fr,
            text="YouTube Data API — subscriber filters",
            variable=self.search_mode,
            value="api",
            command=self._on_search_mode,
        ).pack(anchor=tk.W, pady=2)
        ttk.Radiobutton(
            mode_fr,
            text="Bina API (yt-dlp) — tez, key ki zaroorat nahi",
            variable=self.search_mode,
            value="noapi",
            command=self._on_search_mode,
        ).pack(anchor=tk.W, pady=2)

        key_fr = self._section(left, "API keys (priority: upar → neeche)")
        key_fr.pack(fill=tk.X, pady=(0, 10))
        ttk.Label(
            key_fr,
            text="Har line par ek key. Pehli khatam / quota → agli. Phir se pehli try hoti hai.",
            font=(_FONT_UI, 8),
            foreground="gray",
            wraplength=340,
        ).pack(anchor=tk.W)
        _saved = crawler.load_saved_api_keys()
        self.api_keys_text = tk.Text(
            key_fr,
            height=4,
            width=44,
            font=("Consolas", 9),
            wrap=tk.WORD,
        )
        self.api_keys_text.pack(fill=tk.X, pady=(6, 8))
        if _saved:
            self.api_keys_text.insert("1.0", "\n".join(_saved))
        kb = ttk.Frame(key_fr)
        kb.pack(fill=tk.X)
        ttk.Button(kb, text="Save locally", command=self._save_api_key_click).pack(side=tk.LEFT)
        ttk.Button(kb, text="Clear saved", command=self._clear_saved_api_key_click).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(kb, text="Refresh quota", command=self._refresh_quota_hint).pack(side=tk.LEFT, padx=(8, 0))
        self.api_key_hint = ttk.Label(
            key_fr,
            text=str(crawler.api_key_config_path()),
            font=(_FONT_UI, 8),
            foreground="gray",
            wraplength=340,
        )
        self.api_key_hint.pack(anchor=tk.W, pady=(6, 0))
        self.quota_hint_var = tk.StringVar(value="")
        self.quota_hint_label = ttk.Label(
            key_fr,
            textvariable=self.quota_hint_var,
            font=(_FONT_UI, 8),
            foreground="#8888aa",
            wraplength=340,
            justify=tk.LEFT,
        )
        self.quota_hint_label.pack(anchor=tk.W, pady=(4, 0))
        self._refresh_quota_hint()

        how_fr = self._section(left, "Search type")
        how_fr.pack(fill=tk.X, pady=(0, 10))
        self.search_how = tk.StringVar(value="name")
        ttk.Radiobutton(how_fr, text="Naam / keyword", variable=self.search_how, value="name", command=self._on_search_how).pack(anchor=tk.W, pady=2)
        ttk.Radiobutton(how_fr, text="Category", variable=self.search_how, value="category", command=self._on_search_how).pack(anchor=tk.W, pady=2)

        ttk.Label(how_fr, text="Keyword").pack(anchor=tk.W, pady=(8, 0))
        self.name_var = tk.StringVar()
        self.name_entry = ttk.Entry(how_fr, textvariable=self.name_var)
        self.name_entry.pack(fill=tk.X, pady=(2, 6))
        ttk.Label(how_fr, text="Category").pack(anchor=tk.W)
        cat_names = [x[0] for x in crawler.VIDEO_CATEGORIES]
        self.category_var = tk.StringVar(value=cat_names[0] if cat_names else "")
        self.category_combo = ttk.Combobox(how_fr, textvariable=self.category_var, values=cat_names, state="readonly", width=36)
        self.category_combo.pack(fill=tk.X, pady=(2, 0))

        filt = self._section(left, "Filters (API mode)")
        filt.pack(fill=tk.X, pady=(0, 10))
        g1 = ttk.Frame(filt)
        g1.pack(fill=tk.X)
        ttk.Label(g1, text="Max ch.").grid(row=0, column=0, sticky=tk.W, padx=(0, 8), pady=2)
        self.max_res_var = tk.StringVar(value="50")
        self.max_res_spin = ttk.Spinbox(g1, from_=1, to=500, textvariable=self.max_res_var, width=8)
        self.max_res_spin.grid(row=0, column=1, sticky=tk.W, pady=2)
        ttk.Label(g1, text="Min subs").grid(row=1, column=0, sticky=tk.W, padx=(0, 8), pady=2)
        self.min_subs_var = tk.StringVar(value="0")
        self.min_subs_spin = ttk.Spinbox(g1, from_=0, to=10_000_000_000, textvariable=self.min_subs_var, width=12)
        self.min_subs_spin.grid(row=1, column=1, sticky=tk.W, pady=2)
        ttk.Label(g1, text="Max subs (0=∞)").grid(row=2, column=0, sticky=tk.W, padx=(0, 8), pady=2)
        self.max_subs_var = tk.StringVar(value="0")
        self.max_subs_spin = ttk.Spinbox(g1, from_=0, to=10_000_000_000, textvariable=self.max_subs_var, width=12)
        self.max_subs_spin.grid(row=2, column=1, sticky=tk.W, pady=2)
        ttk.Label(g1, text="Min videos").grid(row=3, column=0, sticky=tk.W, padx=(0, 8), pady=2)
        self.min_vid_var = tk.StringVar(value="0")
        self.min_vid_spin = ttk.Spinbox(g1, from_=0, to=10_000_000, textvariable=self.min_vid_var, width=12)
        self.min_vid_spin.grid(row=3, column=1, sticky=tk.W, pady=2)
        ttk.Label(g1, text="Country").grid(row=4, column=0, sticky=tk.W, padx=(0, 8), pady=2)
        self.country_var = tk.StringVar(value=crawler.channel_country_combo_labels()[0])
        self.country_combo = ttk.Combobox(
            g1,
            textvariable=self.country_var,
            values=crawler.channel_country_combo_labels(),
            state="readonly",
            width=28,
        )
        self.country_combo.grid(row=4, column=1, sticky=tk.W, pady=2)

        g2 = ttk.Frame(filt)
        g2.pack(fill=tk.X, pady=(8, 0))
        self.forbid_tt = tk.BooleanVar(value=False)
        self.forbid_fb = tk.BooleanVar(value=False)
        self.exclude_verified = tk.BooleanVar(value=False)
        ttk.Checkbutton(g2, text="Skip TikTok in description", variable=self.forbid_tt).pack(anchor=tk.W)
        ttk.Checkbutton(g2, text="Skip Facebook in description", variable=self.forbid_fb).pack(anchor=tk.W, pady=(4, 0))
        ttk.Checkbutton(g2, text="Skip verified channels", variable=self.exclude_verified).pack(anchor=tk.W, pady=(4, 0))

        self.filter_mode_note = ttk.Label(filt, text="", wraplength=340, justify=tk.LEFT)
        self.filter_mode_note.pack(anchor=tk.W, pady=(10, 0))
        ttk.Label(
            filt,
            text="Country: channel ka YouTube par set mulk (ISO). Verified filter page-badge heuristic se check hota hai.",
            font=(_FONT_UI, 8),
            foreground="gray",
            wraplength=340,
        ).pack(anchor=tk.W, pady=(6, 0))

        act = ttk.Frame(left)
        act.pack(fill=tk.X, pady=(4, 0))
        self.search_btn = ttk.Button(act, text="▶  Run search", command=self._run_search, style="Accent.TButton" if _HAS_SV else "TButton")
        self.search_btn.pack(fill=tk.X, pady=(0, 6))
        row_ex = ttk.Frame(act)
        row_ex.pack(fill=tk.X)
        ttk.Button(row_ex, text="Export CSV", command=self._save_search_csv).pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(row_ex, text="Export JSON", command=self._save_search_json).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(8, 0))

        # —— Right column: results ——
        res_hdr = ttk.Frame(right)
        res_hdr.pack(fill=tk.X, pady=(0, 4))
        ttk.Label(res_hdr, text="Results", font=(_FONT_UI, 12, "bold")).pack(side=tk.LEFT)
        self.search_status = ttk.Label(res_hdr, text="Ready", font=(_FONT_UI, 9), foreground="gray")
        self.search_status.pack(side=tk.RIGHT)
        ttk.Label(
            right,
            text="Ctrl+C: row copy · URL column click: Chrome · Right-click: copy menu",
            font=(_FONT_UI, 8),
            foreground="gray",
        ).pack(anchor=tk.W, pady=(0, 6))

        tree_fr = ttk.Frame(right)
        tree_fr.pack(fill=tk.BOTH, expand=True)
        self._search_tree_cols = ("name", "username", "country", "subscribers", "videos", "url")
        cols = self._search_tree_cols
        self.search_tree = ttk.Treeview(tree_fr, columns=cols, show="headings", selectmode="browse")
        self.search_tree.heading("name", text="Channel")
        self.search_tree.heading("username", text="Username")
        self.search_tree.heading("country", text="Country")
        self.search_tree.heading("subscribers", text="Subscribers")
        self.search_tree.heading("videos", text="Videos")
        self.search_tree.heading("url", text="URL (click)")
        self.search_tree.column("name", width=160, minwidth=100)
        self.search_tree.column("username", width=110, minwidth=70)
        self.search_tree.column("country", width=48, anchor=tk.CENTER)
        self.search_tree.column("subscribers", width=88, anchor=tk.E)
        self.search_tree.column("videos", width=56, anchor=tk.E)
        self.search_tree.column("url", width=260, minwidth=140)
        sy = ttk.Scrollbar(tree_fr, orient=tk.VERTICAL, command=self.search_tree.yview)
        self.search_tree.configure(yscrollcommand=sy.set)
        self.search_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sy.pack(side=tk.RIGHT, fill=tk.Y)
        self.search_tree.bind("<ButtonRelease-1>", self._search_tree_release)
        self.search_tree.bind("<Control-c>", self._search_copy_selection)
        self.search_tree.bind("<Control-C>", self._search_copy_selection)
        self.search_tree.bind("<Button-3>", self._search_tree_context_menu)

        self._on_search_mode()
        self._on_search_how()

    def _api_keys_from_ui(self) -> list[str]:
        raw = self.api_keys_text.get("1.0", tk.END)
        lines = [x.strip() for x in raw.splitlines() if x.strip()]
        return lines if lines else crawler.resolve_api_keys(None)

    def _refresh_quota_hint(self) -> None:
        keys = self._api_keys_from_ui()
        if not keys:
            self.quota_hint_var.set("Quota: — (key likho ya env / saved file)")
            return
        self.quota_hint_var.set("Quota (estimate aaj): " + quota_summary_text(keys))
        w = quota_warning(keys)
        if w:
            self.quota_hint_var.set(self.quota_hint_var.get() + "  |  " + w.replace("\n", " "))

    def _save_api_key_click(self) -> None:
        raw = self.api_keys_text.get("1.0", tk.END)
        lines = [x.strip() for x in raw.splitlines() if x.strip()]
        if not lines:
            messagebox.showwarning("API keys", "Kam az kam ek key likho (line).")
            return
        try:
            crawler.save_api_keys_to_disk(lines)
        except OSError as e:
            messagebox.showerror("Save", str(e))
            return
        self._refresh_quota_hint()
        messagebox.showinfo("Save", f"{len(lines)} key(s) save.\n{crawler.api_key_config_path()}")

    def _clear_saved_api_key_click(self) -> None:
        if not messagebox.askyesno("Confirm", "Disk se saved keys delete kar do?"):
            return
        try:
            crawler.save_api_keys_to_disk([])
        except OSError as e:
            messagebox.showerror("Clear", str(e))
            return
        self.api_keys_text.delete("1.0", tk.END)
        self._refresh_quota_hint()
        messagebox.showinfo("Clear", "Saved keys hata di gayin.")

    def _on_search_mode(self) -> None:
        no_api = self.search_mode.get() == "noapi"
        self.api_keys_text.configure(state=("disabled" if no_api else "normal"))
        for w in (self.min_subs_spin, self.max_subs_spin, self.min_vid_spin, self.country_combo):
            w.configure(state=("disabled" if no_api else "normal"))
        if not no_api:
            self.country_combo.configure(state="readonly")
        if no_api:
            self.filter_mode_note.configure(
                text=(
                    "Bina API: subscriber / video count filters yahan kaam nahi karte. "
                    "Un filters ke liye 'YouTube Data API' chuno aur key lagao."
                )
            )
        else:
            self.filter_mode_note.configure(
                text="API mode: Min/Max subs aur Min videos lagu honge. Max subs 0 = koi ceiling nahi."
            )

    def _on_search_how(self) -> None:
        cat = self.search_how.get() == "category"
        self.name_entry.configure(state=("disabled" if cat else "normal"))
        self.category_combo.configure(state=("readonly" if cat else "disabled"))

    def _run_search(self) -> None:
        if self.search_btn.cget("state") == "disabled":
            return
        use_api = self.search_mode.get() == "api"
        by_cat = self.search_how.get() == "category"

        if use_api:
            keys = self._api_keys_from_ui()
            if not keys:
                messagebox.showwarning("API keys", "Key likho (lines) ya env YOUTUBE_API_KEY / Save locally.")
                return
        else:
            keys = []

        if by_cat:
            label = self.category_var.get().strip()
            if not label:
                messagebox.showwarning("Category", "Category chuno.")
                return
        else:
            kw = self.name_var.get().strip()
            if not kw:
                messagebox.showwarning("Keyword", "Keyword likho.")
                return

        try:
            max_r = int(self.max_res_var.get())
            min_s = int(self.min_subs_var.get())
            max_s_raw = int(self.max_subs_var.get())
            max_s = None if max_s_raw == 0 else max_s_raw
            min_v = int(self.min_vid_var.get())
        except ValueError:
            messagebox.showerror("Numbers", "Numbers theek se likho.")
            return

        cat_label = self.category_var.get().strip() if by_cat else ""
        name_kw = self.name_var.get().strip() if not by_cat else ""
        country_filter = crawler.parse_channel_country_combo_label(self.country_var.get()) if use_api else None

        for i in self.search_tree.get_children():
            self.search_tree.delete(i)
        self._search_rows = []

        self.search_btn.configure(state="disabled")
        self.search_status.configure(text="Searching…")
        if use_api:
            self.after(0, self._refresh_quota_hint)

        def on_channel_live(ch: dict[str, Any]) -> None:
            self.after(0, lambda c=ch: self._append_search_row(c))

        def job() -> None:
            try:
                if use_api:
                    pool = YouTubeApiPool(keys)
                    if by_cat:
                        cid = crawler.category_id_from_label(cat_label)
                        if not cid:
                            self.after(0, lambda: self._search_fail(f"Category unknown: {cat_label}"))
                            return
                        rows = crawler.search_channels_by_category_api(
                            pool,
                            cid,
                            max_results=max_r,
                            min_subs=min_s,
                            max_subs=max_s,
                            min_videos=min_v,
                            forbid_tiktok=self.forbid_tt.get(),
                            forbid_facebook=self.forbid_fb.get(),
                            country_code=country_filter,
                            exclude_verified=self.exclude_verified.get(),
                            quiet=True,
                            on_channel=on_channel_live,
                            cache_ttl_sec=90.0,
                        )
                    else:
                        rows = crawler.search_channels(
                            pool,
                            name_kw,
                            max_results=max_r,
                            min_subs=min_s,
                            max_subs=max_s,
                            min_videos=min_v,
                            forbid_tiktok=self.forbid_tt.get(),
                            forbid_facebook=self.forbid_fb.get(),
                            country_code=country_filter,
                            exclude_verified=self.exclude_verified.get(),
                            quiet=True,
                            on_channel=on_channel_live,
                            cache_ttl_sec=90.0,
                        )
                else:
                    q = cat_label if by_cat else name_kw
                    rows = crawler.search_channels_ytdlp(
                        q,
                        max_results=max_r,
                        forbid_tiktok=self.forbid_tt.get(),
                        forbid_facebook=self.forbid_fb.get(),
                        exclude_verified=self.exclude_verified.get(),
                        quiet=True,
                        on_channel=on_channel_live,
                    )
                self.after(0, lambda r=rows: self._search_done(r))
            except RuntimeError as e:
                self.after(0, lambda err=str(e): self._search_fail(err))
            except Exception as e:
                self.after(0, lambda err=e: self._search_fail(str(err)))

        threading.Thread(target=job, daemon=True).start()

    def _append_search_row(self, ch: dict[str, Any]) -> None:
        self._search_rows.append(ch)
        subs = ch.get("subscribers", "")
        vids = ch.get("videos", "")
        if subs is None or subs == "":
            subs_disp = "—"
        elif isinstance(subs, int):
            subs_disp = f"{subs:,}"
        else:
            subs_disp = str(subs)
        if vids == "":
            vids_disp = "—"
        elif isinstance(vids, int):
            vids_disp = f"{vids:,}"
        else:
            vids_disp = str(vids)
        ctry = ch.get("country", "") or "—"
        uname = (ch.get("username") or "").strip() or "—"
        iid = self.search_tree.insert(
            "",
            tk.END,
            values=(ch.get("name", ""), uname, ctry, subs_disp, vids_disp, ch.get("url", "")),
        )
        self.search_tree.see(iid)
        self.search_status.configure(text=f"{len(self._search_rows)} found…")

    def _search_done(self, rows: list[dict[str, Any]]) -> None:
        self._search_rows = list(rows)
        self.search_btn.configure(state="normal")
        n = len(rows)
        self.search_status.configure(text=f"Done · {n} channel(s)")
        self._refresh_quota_hint()
        if n == 0:
            how = self.search_how.get()
            if how == "category":
                mode_line = f"Category: {self.category_var.get()}"
            else:
                kw = self.name_var.get().strip()
                mode_line = f"Keyword: {kw!r}" if kw else "Keyword: (khali — naam wala mode mein likho)"
            try:
                mc = int(self.max_res_var.get())
                ms = int(self.min_subs_var.get())
                mxr = int(self.max_subs_var.get())
                mv = int(self.min_vid_var.get())
            except ValueError:
                mc = ms = mxr = mv = 0
            maxs_txt = "koi max nahi" if mxr == 0 else str(mxr)
            c_line = self.country_var.get().strip() if self.search_mode.get() == "api" else "Any"
            v_line = "ON" if self.exclude_verified.get() else "OFF"
            msg = (
                f"0 channels mile.\n\n"
                f"Abhi search: {mode_line}\n"
                f"Filters: Max {mc} | Min subs {ms} | Max subs {maxs_txt} | Min videos {mv} | Country: {c_line} | Skip verified: {v_line}\n\n"
                "• Country strict hai — channel ne YouTube par mulk set na kiya ho to skip.\n"
                "• Min videos / subs limits thodi kam karke try karein.\n"
                "Note: Min subs / Max subs set hon to chhupe hue count wale channels list mein nahi aate."
            )
            messagebox.showinfo("Koi result nahi", msg)

    def _search_fail(self, msg: str) -> None:
        self.search_btn.configure(state="normal")
        self.search_status.configure(text="Error")
        messagebox.showerror("Search", msg)

    def _open_youtube_in_chrome(self, url: str) -> None:
        if not url.startswith("http"):
            return
        candidates = [
            os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(
                os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
                "Google",
                "Chrome",
                "Application",
                "chrome.exe",
            ),
        ]
        for exe in candidates:
            if os.path.isfile(exe):
                subprocess.Popen([exe, url], close_fds=sys.platform != "win32")
                return
        webbrowser.open(url)

    def _search_tree_release(self, event: tk.Event) -> None:
        if self.search_tree.identify_region(event.x, event.y) != "cell":
            return
        row_id = self.search_tree.identify_row(event.y)
        if not row_id:
            return
        col = self.search_tree.identify_column(event.x)
        try:
            idx = int(col.replace("#", "")) - 1
        except ValueError:
            return
        cols = self._search_tree_cols
        if idx < 0 or idx >= len(cols) or cols[idx] != "url":
            return
        vals = self.search_tree.item(row_id, "values")
        if len(vals) <= idx:
            return
        url = str(vals[idx]).strip()
        if url.startswith("http"):
            self._open_youtube_in_chrome(url)

    def _search_copy_selection(self, event: tk.Event | None = None) -> str:
        sel = self.search_tree.selection()
        if not sel:
            return "break"
        vals = self.search_tree.item(sel[0], "values")
        line = "\t".join(str(v) for v in vals)
        self.clipboard_clear()
        self.clipboard_append(line)
        n = len(self._search_rows)
        self.search_status.configure(text="Row copied (Ctrl+C)")
        self.after(2500, lambda: self.search_status.configure(text=f"Done · {n} channel(s)" if n else "Ready"))
        return "break"

    def _copy_search_row_to_clipboard(self, row_id: str) -> None:
        vals = self.search_tree.item(row_id, "values")
        line = "\t".join(str(v) for v in vals)
        self.clipboard_clear()
        self.clipboard_append(line)

    def _copy_search_url_to_clipboard(self, row_id: str) -> None:
        vals = list(self.search_tree.item(row_id, "values"))
        url_idx = self._search_tree_cols.index("url")
        if len(vals) > url_idx:
            self.clipboard_clear()
            self.clipboard_append(str(vals[url_idx]))

    def _search_tree_context_menu(self, event: tk.Event) -> None:
        row_id = self.search_tree.identify_row(event.y)
        if not row_id:
            return
        self.search_tree.selection_set(row_id)
        menu = tk.Menu(self, tearoff=0)
        menu.add_command(label="Copy row", command=lambda: self._copy_search_row_to_clipboard(row_id))
        menu.add_command(label="Copy URL", command=lambda: self._copy_search_url_to_clipboard(row_id))
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _save_search_csv(self) -> None:
        if not self._search_rows:
            messagebox.showinfo("Save", "Pehle search chalao.")
            return
        path = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")])
        if not path:
            return
        crawler.write_channel_search_csv(Path(path), self._search_rows)
        messagebox.showinfo("Save", f"Save ho gaya:\n{path}")

    def _save_search_json(self) -> None:
        if not self._search_rows:
            messagebox.showinfo("Save", "Pehle search chalao.")
            return
        path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON", "*.json")])
        if not path:
            return
        crawler.write_json(Path(path), self._search_rows)
        messagebox.showinfo("Save", f"Save ho gaya:\n{path}")

    def _build_crawl_tab(self, nb: ttk.Notebook) -> None:
        tab = ttk.Frame(nb, padding=4)
        nb.add(tab, text="  Video crawl  ")

        split = ttk.Frame(tab)
        split.pack(fill=tk.BOTH, expand=True)

        left = self._scrollable_sidebar(split)
        right = ttk.Frame(split)
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        opt = self._section(left, "Source")
        opt.pack(fill=tk.X, pady=(0, 10))
        ttk.Label(opt, text="Channel ya playlist URL").pack(anchor=tk.W)
        self.crawl_url = tk.StringVar()
        ttk.Entry(opt, textvariable=self.crawl_url).pack(fill=tk.X, pady=(4, 10))
        ttk.Label(opt, text="Max videos (khali = sab)").pack(anchor=tk.W)
        self.crawl_max = tk.StringVar()
        ttk.Entry(opt, textvariable=self.crawl_max, width=12).pack(anchor=tk.W, pady=(4, 8))
        self.crawl_full = tk.BooleanVar(value=False)
        ttk.Checkbutton(opt, text="Full metadata (slow)", variable=self.crawl_full).pack(anchor=tk.W)

        act = ttk.Frame(left)
        act.pack(fill=tk.X, pady=(8, 0))
        self.crawl_btn = ttk.Button(act, text="▶  Run crawl", command=self._run_crawl, style="Accent.TButton" if _HAS_SV else "TButton")
        self.crawl_btn.pack(fill=tk.X, pady=(0, 6))
        ttk.Button(act, text="Export CSV / JSON", command=self._save_crawl).pack(fill=tk.X)

        hdr = ttk.Frame(right)
        hdr.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(hdr, text="Videos", font=(_FONT_UI, 12, "bold")).pack(side=tk.LEFT)
        self.crawl_status = ttk.Label(hdr, text="URL enter karein", font=(_FONT_UI, 9), foreground="gray")
        self.crawl_status.pack(side=tk.RIGHT)

        tree_fr = ttk.Frame(right)
        tree_fr.pack(fill=tk.BOTH, expand=True)
        ccols = ("title", "views", "url")
        self.crawl_tree = ttk.Treeview(tree_fr, columns=ccols, show="headings", height=18)
        self.crawl_tree.heading("title", text="Title")
        self.crawl_tree.heading("views", text="Views")
        self.crawl_tree.heading("url", text="URL")
        self.crawl_tree.column("title", width=340, minwidth=160)
        self.crawl_tree.column("views", width=88, anchor=tk.E)
        self.crawl_tree.column("url", width=300, minwidth=140)
        sy = ttk.Scrollbar(tree_fr, orient=tk.VERTICAL, command=self.crawl_tree.yview)
        self.crawl_tree.configure(yscrollcommand=sy.set)
        self.crawl_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sy.pack(side=tk.RIGHT, fill=tk.Y)

    def _run_crawl(self) -> None:
        url = self.crawl_url.get().strip()
        if not url:
            messagebox.showwarning("URL", "URL likho.")
            return
        max_raw = self.crawl_max.get().strip()
        max_n = int(max_raw) if max_raw else None
        self.crawl_btn.configure(state="disabled")
        self.crawl_status.configure(text="Crawling…")

        def job() -> None:
            try:
                rows = crawler.crawl(url, max_items=max_n, flat_only=not self.crawl_full.get())
                self.after(0, lambda r=rows: self._crawl_done(r))
            except Exception as e:
                self.after(0, lambda err=e: self._crawl_fail(str(err)))

        threading.Thread(target=job, daemon=True).start()

    def _crawl_done(self, rows: list[dict[str, Any]]) -> None:
        self._crawl_rows = rows
        self.crawl_btn.configure(state="normal")
        self.crawl_status.configure(text=f"{len(rows)} videos")
        for i in self.crawl_tree.get_children():
            self.crawl_tree.delete(i)
        for v in rows:
            vc = v.get("view_count")
            vc_s = f"{vc:,}" if isinstance(vc, int) else (str(vc) if vc is not None else "")
            self.crawl_tree.insert("", tk.END, values=(v.get("title", ""), vc_s, v.get("url", "")))

    def _crawl_fail(self, msg: str) -> None:
        self.crawl_btn.configure(state="normal")
        self.crawl_status.configure(text="Error")
        messagebox.showerror("Crawl", msg)

    def _save_crawl(self) -> None:
        if not self._crawl_rows:
            messagebox.showinfo("Save", "Pehle crawl chalao.")
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("CSV", "*.csv")],
        )
        if not path:
            return
        p = Path(path)
        if p.suffix.lower() == ".csv":
            crawler.write_csv(p, self._crawl_rows)
        else:
            crawler.write_json(p, self._crawl_rows)
        messagebox.showinfo("Save", f"Save ho gaya:\n{path}")


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()

# 🌵 YUYUGUI: THE THORN CHRONICLES (COMPLETE EDITION) 🌵
> "Sebuah catatan perjuangan menaklukkan Android 14 dan Termux:GUI 0.1.6"

## 📱 Device Info
- **OS:** Android 14 (Level Api 34)
- **App:** Termux & Termux:GUI 0.1.6
- **Status:** Kemenangan Native (WebView masih berstatus 'Gencatan Senjata')

---

## 📜 LOG PERALihan & DAFTAR DURI (ERROR LOG)

| Duri No | Kode Nama | Gejala | Penyebab Sebenarnya | Solusi / Penawar |
| :--- | :--- | :--- | :--- | :--- |
| **01** | `AttributeError` | `setData` tidak ditemukan | Case-sensitive pada library | Gunakan `setdata` (huruf kecil semua) |
| **02** | `Activity Error` | Force Close di awal | Activity butuh bind ke view | Gunakan auto-bind: `WebView(activity)` |
| **03** | `Loop Dead` | GUI tidak merespon | Generator event tidak dikuras | Gunakan `list(conn.events())` di loop |
| **04** | `White Screen` | Layar putih lalu hilang | OpenGL Swap Behavior Mismatch | Pindah ke Native UI / Delay Injeksi |
| **05** | `Broken Pipe` | `Errno 32` | Socket diputus paksa oleh Android | Persistent Re-injection loop |
| **06** | **NPE CRASH** | **Force Close Masif** | `setgridlayoutparams` mengirim NULL | **HAPUS** semua setting grid layout |
| **07** | `Attr Error` | `setpadding` error | Method tidak dikenal di 0.1.6 | Gunakan TextView kosong sebagai spacer |
| **08** | `Event Error` | `event.get()` error | Event adalah Objek, bukan Dict | Akses via `str(event)` atau `event.type` |
| 09 | Input Mismatch | Gak bisa ngetik & tombol kaku | Pakai `EditText` & `LinearLayout` Horizontal |
| 10 | Layout Orientation | `setorientation` gak ada | Pakai sub-LinearLayout & setlinearlayoutparams(weight, w, h) |

---

## 🛠️ FINAL ARCHITECTURE (THE CHAT-TERMINAL HYBRID)

Gunakan kode ini untuk mendapatkan tampilan "Chat App" yang stabil tanpa force close:

```python
import termuxgui as tg
import time

def run_stable_yuyu():
    try:
        with tg.Connection() as conn:
            activity = tg.Activity(conn)
            layout = tg.LinearLayout(activity)

            # --- HEADER ---
            header = tg.TextView(activity, "🟢 YUYU CHAT STABLE", layout)
            header.settextsize(22)
            tg.TextView(activity, "────────────────", layout)

            # --- WEBVIEW (LIGHT MODE) ---
            # Catatan: Jika masih hitam, berarti WebView diblokir OS.
            web = tg.WebView(activity, layout)
            chat_content = """
            <html><body style='background:#121212; color:white; font-family:sans-serif;'>
                <div style='color:#0f0;'><b>Gemini:</b> Pipa stabil, Bro?</div>
                <div style='text-align:right; color:#00afff;'><b>You:</b> Menang mutlak! 😹</div>
            </body></html>
            """
            web.setdata(chat_content)

            # --- NATIVE INPUT SIMULATION ---
            tg.TextView(activity, "yuyu@terminal:~$", layout)
            btn = tg.Button(activity, "KIRIM PESAN", layout)

            # --- EVENT MONITORING ---
            for event in conn.events():
                # Menangani Duri No 08
                if "click" in str(event).lower():
                    print("[+] Tombol diklik! Sinyal aman.")
                time.sleep(0.01)

    except Exception as e:
        print(f"Duri baru muncul: {e}")

run_stable_yuyu()

# 📔 Catatan Teknis: Dokumentasi Implementasi Termux:GUI 0.1.6
**Target OS:** Android 14 (API Level 34)  
**Kondisi Proyek:** Proyek Dihentikan (Legacy / Archived)  
**Arsip Penulis:** Gemini & User (Yuyu)

---

## 📋 Inventarisasi Hambatan Teknis (The 20+ Thorns)
Daftar kendala sistem yang diidentifikasi selama fase pengembangan UI Native dan WebView pada lingkungan Android 14.

### 1. Fase Inisialisasi & Konektivitas
* **Duri 01 (Case-Sensitivity):** Library hanya mengenali method `setdata()`. Penggunaan `setData()` menyebabkan *AttributeError*.
* **Duri 02 (Activity Binding):** View wajib di-bind ke objek `Activity(conn)` agar tidak terjadi *Force Close*.
* **Duri 03 (Socket Hunger):** Koneksi harus dibungkus dalam `with tg.Connection()` agar pipa komunikasi terbuka.
* **Duri 04 (Event Clogging):** Generator `conn.events()` harus dikuras dalam loop agar UI tidak *freeze*.
* **Duri 05 (Broken Pipe):** Error `Errno 32` muncul saat Android memutus komunikasi socket secara paksa.

### 2. Masalah Rendering & Visual (Android 14)
* **Duri 06 (Swap Behavior):** Kegagalan `OpenGLRenderer` yang menyebabkan fenomena "Layar Putih".
* **Duri 07 (WebView Blackout):** Konflik Akselerasi Perangkat Keras yang mengakibatkan WebView menjadi hitam kosong.
* **Duri 08 (NullPointerException):** `setgridlayoutparams` mengirim nilai NULL ke API Java, memicu crash sistemik.
* **Duri 09 (Missing Method):** Atribut `setpadding()` tidak terdaftar secara resmi di bridge Python v0.1.6.
* **Duri 10 (Layout Reset):** WebView sering kali kembali ke ukuran default jika parameter layout tidak di-inject ulang.

### 3. Logika Interaksi & Properti Objek
* **Duri 11 (Object Mismatch):** Objek event bukan tipe *dictionary*. Penggunaan `.get()` akan gagal (Harus via properti).
* **Duri 12 (Orientation Lock):** Method `setorientation()` tidak tersedia secara default pada class LinearLayout.
* **Duri 13 (Positional Overload):** `setlinearlayoutparams()` menolak lebih dari 3 argumen karena konflik `self` di Python.
* **Duri 14 (Argument Order):** Ketidakpastian urutan (weight, width, height) yang sering memicu *TypeError*.
* **Duri 15 (Component Mismatch):** Kebingungan fungsi antara `TextView` (statis) dan `EditText` (interaktif).

### 4. Limitasi Input & User Experience
* **Duri 16 (Keyboard Focus):** Kesulitan memicu *soft keyboard* secara otomatis pada API Level 34.
* **Duri 17 (Event Latency):** Jeda waktu yang signifikan antara interaksi fisik dan respon eksekusi script.
* **Duri 18 (Manual Spacing):** Ketiadaan margin/padding memaksa penggunaan elemen kosong sebagai *spacer*.
* **Duri 19 (Weight Conflict):** Distribusi ruang layar yang kaku jika nilai proporsi tidak didefinisikan secara presisi.
* **Duri 20 (Event Parsing):** Deteksi input yang tidak stabil tanpa konversi manual ke tipe data String.

### 5. Konklusi & Rencana Pengembangan Masa Depan
* **Duri 21 (Customization Barrier):** Keterbatasan kustomisasi CSS dan gaya yang sangat arkais.
* **Duri 22 (Strategic Pivot):** Keputusan beralih ke arsitektur Web-UI (Flask/PWA) demi stabilitas jangka panjang.
* **Duri 23 (The Fork Resolution):** Rencana untuk melakukan *fork* pada library guna memperbaiki *bridge* Java-Python yang usang.

---

## 🛠️ Arsitektur Kode Stabil Terakhir
Implementasi paling optimal yang berhasil dijalankan sebelum proyek diarsipkan:

```python
import termuxgui as tg
import time

def run_stable_session():
    try:
        with tg.Connection() as conn:
            activity = tg.Activity(conn)
            main_layout = tg.LinearLayout(activity)
            
            # Header Section
            header = tg.TextView(activity, "SYSTEM LOG: STABLE", main_layout)
            header.settextsize(20)
            
            # Display Area (WebView)
            display = tg.WebView(activity, main_layout)
            display.setlinearlayoutparams(-1, -1) 
            display.setdata("<html><body style='background:#000; color:#0f0;'>Session Active.</body></html>")
            
            # Interactive Input Section
            input_field = tg.EditText(activity, main_layout)
            input_field.setlinearlayoutparams(-1, -2) 
            
            for event in conn.events():
                if "click" in str(event).lower():
                    # Logika penanganan input user
                    pass
                time.sleep(0.01)
    except Exception as e:
        print(f"Kritikal Error: {e}")

if __name__ == "__main__":
    run_stable_session()

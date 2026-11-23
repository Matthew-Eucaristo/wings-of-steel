# WINGS OF STEEL — Korps Sayap Baja

Aksi ODM-gear melawan titan di browser: pimpin skuadron AI, kawal Regu Insinyur, tutup Gerbang Selatan.

**Main sekarang:** https://matthew-eucaristo.github.io/wings-of-steel/

![Wings of Steel](public/og.jpg)

## Mode

- **OPERASI SEGEL** — kampanye: kawal konvoi Insinyur menutup gerbang, fase demi fase hingga Titan Lapis.
- **PERTAHANAN** — endless: tahan Distrik Halvard selama mungkin, gelombang makin berat.
- **ARENA LATIHAN** — latihan tebasan pada titan pasif.

## Kontrol

| Input | Aksi |
| --- | --- |
| `Q` / `E` / Klik Kanan | kait kiri / kanan (tahan dua kait) |
| `Spasi` | tarik kabel · lompat · pantul |
| `Shift` + `WASD` | belok jet tajam · `S`+`Shift` rem |
| Klik Kiri | tebas / eksekusi tengkuk |
| `X` | tembak / ledakkan Rudal Petir |
| `T` | perintah Skuadron & Meriam |
| `R` / `C` | ganti pedang / silinder gas |
| `F` / `V` / `H` | mode kait / POV / bantuan |

Gamepad juga didukung penuh (LT/RT kait, X tebas, D-Pad perintah & pilih upgrade).

## Pengembangan

```bash
npm install
npm run dev      # dev server :5173
npm run build    # build ke dist/ (dideploy GitHub Pages)
npm run verify   # headless smoke-test: render, sistem, alur cerita
```

Teknologi: three.js + Vite, tanpa framework — ES modules murni.

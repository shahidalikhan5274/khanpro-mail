# 🚀 KHANPRO.ME - Complete Setup & Deployment Guide

Aapka **Next-Gen Web Tools & Student Email Infrastructure Platform** mukammal ready hai! Yeh platform aapke `khanpro.me` domain par live hone ke baad:
1. **Domain Trust Score** ko maximum kar dega (kyunki real website + tools live honge).
2. Students ko **Self-Service Activation** dega (Roll number daalein aur Gmail select karein).
3. Aapko **Cluster Control & Bulk Generator** dega (500 students ek second me divide honge).
4. **100% FREE** chalega bina kisi hosting ya tool ke charges ke.

---

## 📂 Project Structure

* [index.html](file:///c:/Users/Shahid/Desktop/mail/index.html) - Ultra-modern, responsive website (Public Web Tools + Protected Student Mail Engine).
* [styles.css](file:///c:/Users/Shahid/Desktop/mail/styles.css) - Premium Obsidian dark mode, glassmorphism, responsive styles.
* [app.js](file:///c:/Users/Shahid/Desktop/mail/app.js) - Complete frontend logic, passkey authentication, simulator, tools, and cluster management.
* [worker.js](file:///c:/Users/Shahid/Desktop/mail/worker.js) - Production Cloudflare Email Worker code.

---

## 🔐 Permission & Access Control (Public Tools vs Private Mail)

1. **Public Web Tools (Everyone can use):**
   * Password Generator, QR Code Studio, DNS Inspector, Text Transformer tamam public visitors ke liye open hain. Isse domain ka **Trust Score** hamesha high rahega!
2. **Student Mail Portal (Restricted):**
   * Jab aam public visitor aayega, to Student Mail Portal lock hoga (`Restricted Campus Service`).
   * **Default Student Passkey:** `Rafay5@74` (Aap jin students ko allow karenge, unhe yeh passkey denge taake woh apna email activate kar sakein).
3. **Master Admin Panel (Your Private Control):**
   * **Default Master Admin Key:** `Shahid5@74`
   * Master Admin panel me aap baith kar jab chahein:
     * Student Passkey badal sakte hain.
     * Apna Master Admin Passkey badal sakte hain.
     * Naye Gmails add/delete kar sakte hain.

---

## 🛠️ Step 1: Apne Computer Par Abhi Test Karein

Aap is website ko apne browser me direct open karke check kar sakte hain:
1. Apne computer me `c:\Users\Shahid\Desktop\mail` folder kholein.
2. `index.html` file par double-click karein (Google Chrome ya kisi bhi browser me open ho jayegi).
3. Aap dekhenge:
   * **Self-Activation Tab:** Koi bhi roll number (e.g. `bsf1900166`) likhein aur "Activate" karein.
   * **Live OTP Simulator:** Test email bhej kar live trace terminal dekhein.
   * **Cluster Admin Panel:** Naye Gmails add karein ya 50-500 students bulk generate karein.
   * **Web Tools:** Password generator, QR Code maker, Text converter test karein.

---

## 🌐 Step 2: Website Ko `khanpro.me` Par Free Host Karein (Cloudflare Pages)

Is website ko internet par live karne ke liye:
1. [Cloudflare Dashboard](https://dash.cloudflare.com) me login karein.
2. Left menu se **Workers & Pages** par click karein.
3. **Create Application** > **Pages** > **Upload assets** par click karein.
4. Project ka naam rakhein (e.g. `khanpro`).
5. Apne computer se yeh poora folder (`c:\Users\Shahid\Desktop\mail`) drag and drop kar dein.
6. **Deploy** par click kar dein! Website 10 seconds me live ho jayegi.
7. Cloudflare Pages ki settings me ja kar **Custom Domains** me `khanpro.me` add kar dein.

---

## 📧 Step 3: Cloudflare Email Routing & Worker Setup

### A. Destination Gmails Verify Karein
1. Cloudflare Dashboard me apni domain `khanpro.me` par jayein.
2. Left menu me **Email** > **Email Routing** > **Destination Addresses** par jayein.
3. Apne 2, 4, 10 ya jitne bhi Gmails hain (jaise `batch1.khanpro@gmail.com`), wahan **"Add destination address"** karein.
4. Har Gmail ke inbox me ja kar Cloudflare ka verification link **1 dafa click** kar dein.

### B. Cloudflare Worker Deploy Karein
1. Cloudflare Dashboard me **Workers & Pages** > **Create Worker** par click karein.
2. Name rakhein: `khanpro-email-router`.
3. Editor me hamari [worker.js](file:///c:/Users/Shahid/Desktop/mail/worker.js) ka code copy karke paste karein aur **Deploy** dabayein.

### C. Catch-All Rule Ko Worker Se Connect Karein
1. Wapis `khanpro.me` > **Email** > **Email Routing** > **Routing Rules** par jayein.
2. **Catch-all rule** ko Edit karein:
   * **Action:** Select karein **"Send to Worker"**
   * **Worker:** Select karein `khanpro-email-router`
3. Save kar dein!

---

## 🎯 Ab Yeh System Kaise Kaam Karega?

1. **Student Ke Liye:**
   * Student `https://khanpro.me` par aayega.
   * Apna Roll Number daalega (e.g. `bsf1900166`).
   * Available Verified Gmail me se koi bhi Gmail select karke "Activate" dabayega.
2. **Code / OTP Aane Par:**
   * Jab bhi koi website (Canva, Software, etc.) `bsf1900166@khanpro.me` par code bhejegi:
   * Cloudflare Email Worker use receive karega.
   * Aur foran us selected Gmail ke inbox me deliver kar dega!
3. **Gmail Me Code Dekhne Ka Tareeqa:**
   * Gmail ke search bar me bas likhein:  
     `to:bsf1900166@khanpro.me`  
   * Aur us student ka email/OTP foran saamne aa jayega!

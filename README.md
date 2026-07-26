# BN Warrior V15 Private Cloud

V15 เพิ่ม Google Drive Sync แบบเข้ารหัส โดยใช้ Google Drive `appDataFolder`.

## ความสามารถ
- Local-first: localStorage + IndexedDB
- Encrypted Google Drive sync ด้วย AES-GCM 256-bit
- PBKDF2 SHA-256 250,000 iterations
- Sync มือถือ ↔ Desktop ขณะเปิดแอปและเชื่อม Google
- Conflict detection จากเวลาแก้ไข
- เลือกดึงจาก Drive หรือใช้ข้อมูลเครื่องนี้
- ไม่มี backend และไม่มีค่าใช้จ่าย

## ติดตั้ง
อ่านไฟล์ `GOOGLE_DRIVE_SETUP_TH.txt`

## GitHub Pages
อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ไปที่ root ของ Repository แล้วใช้:
- Source: Deploy from a branch
- Branch: main
- Folder: / (root)

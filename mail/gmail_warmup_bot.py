"""
======================================================================
🔥 KHANPRO.ME - REAL GMAIL PEER-TO-PEER WARMUP BOT (STANDALONE)
======================================================================
Yeh bot aapke computer par chalta hai aur aapke 8 se 10 naye Gmail
accounts ke darmiyan ASAL emails send aur receive karwata hai taake
Google ke algorithm mein unka "Trust Score / Sender Reputation" boost ho jaye!

TAREEQA-E-ISTEMAL (How to use):
1. Jin Gmail accounts ko warm karna hai, un par 2-Step Verification ON karein.
2. Google Account -> Security -> "App passwords" mein ja kar 16-digit password banayein:
   (Link: https://myaccount.google.com/apppasswords)
3. Neeche ACCOUNTS_CONFIG mein har Gmail ke aage uska 16-digit App Password likhein.
4. Terminal/CMD mein run karein:
   python gmail_warmup_bot.py
======================================================================
"""

import smtplib
import time
import random
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ======================================================================
# APNE ACCOUNTS AUR UN K APP PASSWORDS YAHAN LIKHEIN:
# ======================================================================
ACCOUNTS_CONFIG = {
    # "apka_email1@gmail.com": "abcd efgh ijkl mnop",
    # "apka_email2@gmail.com": "qrst uvwx yzab cdef",
    # "apka_email3@gmail.com": "ghij klmn opqr stuv",
}

# Real human-like conversation topics
CONVERSATIONS = [
    ("Project timeline update", "Hi, just checking in to see if you reviewed the latest notes. Let's sync tomorrow morning."),
    ("Re: Lecture notes and resources", "Hey! Thanks for sharing the study material yesterday. It was very helpful."),
    ("Quick question about the presentation", "Hope you are doing well. Do you have 10 minutes free this afternoon to review the slide deck?"),
    ("Document review feedback", "I went over sections 1 through 3 and made a few suggestions. Please check when you get a chance."),
    ("Meeting schedule confirmation", "Confirming our call for Thursday at 3 PM. Let me know if you need to reschedule."),
    ("Updated draft submission", "Attached is the latest revision of our draft. Let me know if anything needs changes.")
]

def send_real_email(sender_email, sender_password, receiver_email, subject, body):
    try:
        msg = MIMEMultipart()
        msg["From"] = sender_email
        msg["To"] = receiver_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        # Connect to Google SMTP
        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(sender_email, sender_password.replace(" ", ""))
        server.sendmail(sender_email, receiver_email, msg.as_string())
        server.quit()

        print(f"✅ [SUCCESS] Sent: {sender_email} ➔ {receiver_email}")
        print(f"   Subject: '{subject}' | Delivered to Inbox!")
        return True
    except Exception as e:
        print(f"❌ [FAILED] Could not send from {sender_email}: {e}")
        return False

def main():
    accounts = list(ACCOUNTS_CONFIG.keys())
    if len(accounts) < 2:
        print("="*65)
        print("⚠️  NOTICE: Warmup ke liye kam az kam 2 Gmail accounts zaroori hain!")
        print("   Is file ko open karke 'ACCOUNTS_CONFIG' mein apne Gmails")
        print("   aur unke 16-digit Google App Passwords add karein.")
        print("   Link to generate app password: https://myaccount.google.com/apppasswords")
        print("="*65)
        return

    print("="*65)
    print("🚀 KhanPro Real Gmail Warmup Engine Starting...")
    print(f"🔥 Active Warmup Pool: {len(accounts)} Gmail accounts")
    print("="*65)

    round_count = 1
    while True:
        print(f"\n--- [Round {round_count}] Exchanging warmup email ---")
        sender = random.choice(accounts)
        receiver = random.choice([acc for acc in accounts if acc != sender])
        password = ACCOUNTS_CONFIG[sender]

        subject, body = random.choice(CONVERSATIONS)
        send_real_email(sender, password, receiver, subject, body)

        # Natural delay between 60 to 180 seconds to mimic real humans
        wait_seconds = random.randint(60, 180)
        print(f"⏳ Agla email {wait_seconds} seconds baad send hoga (Google spam filter se bachne ke liye)...")
        time.sleep(wait_seconds)
        round_count += 1

if __name__ == "__main__":
    main()

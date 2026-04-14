"""
Symmetric encryption for sensitive fields (Garmin password).
Uses Fernet (AES-128-CBC + HMAC-SHA256) derived from SECRET_KEY.
"""

import base64
import hashlib
from cryptography.fernet import Fernet

from config import settings


def _fernet() -> Fernet:
    # Derive a 32-byte key from SECRET_KEY via SHA-256, then base64-encode for Fernet
    key_bytes = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()

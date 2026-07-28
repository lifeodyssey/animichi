"""Self-signed TLS stub server for the SSRF egress guard integration tests.

Not a test module itself (no `test_` functions) — a fixture-support helper so
`test_egress_ssrf_guard.py` can stay under the project's 200-line test-file cap.
"""

from __future__ import annotations

import asyncio
import datetime
import ssl

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
)
from cryptography.x509.oid import NameOID

TEST_HOSTNAME = "guarded.egress-guard.test"


def write_self_signed_cert(directory: object) -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, TEST_HOSTNAME)])
    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName(TEST_HOSTNAME)]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    cert_path = directory / "cert.pem"  # type: ignore[operator]
    key_path = directory / "key.pem"  # type: ignore[operator]
    cert_path.write_bytes(cert.public_bytes(Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption()
        )
    )
    return str(cert_path), str(key_path)


class TlsProbeServer:
    """Minimal HTTPS echo server that records the received Host + SNI."""

    def __init__(self, cert_path: str, key_path: str) -> None:
        self.cert_path = cert_path
        self.key_path = key_path
        self.received_host_header: str | None = None
        self.received_sni: str | None = None
        self.port: int = 0
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(self.cert_path, self.key_path)
        # `SSLObject.server_hostname` reflects the *client's* view and is
        # unreliable to read back from the server side of an asyncio
        # transport; `sni_callback` is the documented way for a server to
        # observe the SNI value the client actually sent.
        ssl_context.sni_callback = self._record_sni
        self._server = await asyncio.start_server(
            self._handle, "127.0.0.1", 0, ssl=ssl_context
        )
        self.port = self._server.sockets[0].getsockname()[1]

    def _record_sni(
        self,
        _ssl_socket: ssl.SSLObject,
        server_name: str | None,
        _ssl_context: ssl.SSLContext,
    ) -> None:
        self.received_sni = server_name

    async def _handle(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        head = await reader.readuntil(b"\r\n\r\n")
        for line in head.split(b"\r\n"):
            if line.lower().startswith(b"host:"):
                self.received_host_header = line.split(b":", 1)[1].strip().decode()
        body = b"ok"
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n%s" % (len(body), body)
        )
        await writer.drain()
        writer.close()

    async def aclose(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

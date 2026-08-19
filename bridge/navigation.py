"""bridge/navigation.py — window navigation + small file readers mixin."""

import json

from .core import logger


class NavigationMixin:
    """Page navigation, public URL resolution and small read-only files."""

    def navigate_to(self, page: str) -> None:
        """Navigate the pywebview window to a different page.
        page is a relative path like 'public/settings.html' or a full URL.
        Returns None to avoid pywebview callback issues when page navigates away.
        """
        if self._window:
            if not page.startswith('http://') and not page.startswith('https://') and not page.startswith('file://'):
                clean_page = page.lstrip('./')
                url = f'http://127.0.0.1:{self._server_port}/{clean_page}'
            else:
                url = page
            self._window.load_url(url)

    def resolve_public_url(self, filename: str, query: dict = None) -> str:
        """Resolve a public file URL."""
        if query:
            qs = '&'.join(f'{k}={v}' for k, v in query.items())
            return f'{filename}?{qs}'
        return filename

    def torch_commands_read(self) -> dict:
        torch_path = self._base_dir / 'components' / 'setup' / 'torchCommands.json'
        if torch_path.exists():
            try:
                return json.loads(torch_path.read_text('utf-8'))
            except Exception:
                pass
        return {}

    def read_docs_file(self, filename: str) -> str:
        """Read a documentation file from the docs/ directory."""
        try:
            docs_path = self._base_dir / 'docs' / filename
            if docs_path.exists():
                return docs_path.read_text('utf-8')
            return None
        except Exception as e:
            logger.error('read_docs_file failed: %s', e)
            return None

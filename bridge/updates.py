"""bridge/updates.py — auto-update + app quit mixin."""

import threading

import updater

from .core import logger


class UpdateMixin:
    """GitHub release update check / download / stage / install."""

    def update_check(self) -> dict:
        """Check GitHub releases for a newer version of mama."""
        try:
            return updater.check_for_update()
        except Exception as e:
            logger.error('update_check failed: %s', e)
            return {'available': False, 'error': str(e)}

    def update_download(self) -> dict:
        """Download the latest update in the background; progress is emitted
        through the '_updateProgressCallback' channel."""
        threading.Thread(target=self._update_download_worker, daemon=True).start()
        return {'started': True}

    def _update_download_worker(self):
        self._enqueue_emit('_updateProgressCallback', {'type': 'status', 'text': 'Downloading update…'})

        def on_progress(received, total):
            self._enqueue_emit('_updateProgressCallback', {
                'type': 'download',
                'received': received,
                'total': total,
                'percent': round(received * 100 / total) if total else 0,
            })

        result = updater.download_update(progress_cb=on_progress)
        if result.get('success'):
            self._enqueue_emit('_updateProgressCallback', {
                'type': 'done', 'size': result.get('size'),
            })
        else:
            self._enqueue_emit('_updateProgressCallback', {
                'type': 'error', 'message': result.get('error'),
            })

    def update_install(self) -> dict:
        """Stage the downloaded update so it is applied on next quit."""
        try:
            result = updater.stage_update()
            if result.get('success'):
                self._enqueue_emit('_updateProgressCallback', {
                    'type': 'ready', 'tag': result.get('tag'),
                })
            else:
                self._enqueue_emit('_updateProgressCallback', {
                    'type': 'error', 'message': result.get('error'),
                })
            return result
        except Exception as e:
            logger.error('update_install failed: %s', e)
            return {'success': False, 'error': str(e)}

    def app_quit(self):
        """Close the window; on_quit then hands off any staged update."""
        if self._window:
            try:
                self._window.destroy()
            except Exception as e:
                logger.error('app_quit failed: %s', e)

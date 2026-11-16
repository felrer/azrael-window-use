#!/usr/bin/python3
"""Linux JSON-lines entry. No elevated access or global input injection."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import uuid


class Failure(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def load_provider():
    # The staged bundle is flat; source checkout reuses the maintained provider.
    source = Path(__file__).with_name('atspi_backend.py')
    if not source.is_file():
        source = Path(__file__).parents[1] / 'window-control/src/linux_backend.py'
    try:
        spec = importlib.util.spec_from_file_location('azrael_linux_atspi', source)
        provider = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(provider)
        return provider
    except (ImportError, ValueError, OSError):
        raise Failure('dependency-missing', 'Linux requires system Python3, PyGObject AT-SPI2/GTK3 and Pillow')


def session_kind():
    # An Xwayland DISPLAY does not make the desktop an X11 session.
    if os.environ.get('XDG_SESSION_TYPE', '').lower() == 'wayland' or os.environ.get('WAYLAND_DISPLAY'):
        return 'wayland'
    return 'x11' if os.environ.get('DISPLAY') else 'headless'


def capabilities(kind):
    available = kind != 'headless'
    return dict(platform='linux', sessionType=kind, accessibility='AT-SPI2',
                windowObservation=available, windowUIAControl=available,
                windowCapture=kind == 'x11', windowRestore=kind == 'x11',
                windowResize=kind == 'x11', desktopCapture=False,
                desktopControl=False, switchedInput=False, independentPointer=False,
                coordinateInput=False, windowKeyInput=kind == 'x11',
                limitations=['X11 capture requires a redirected XComposite window',
                             'Wayland supports exposed AT-SPI frames and semantic actions only',
                             'No global input, pointer reservation or suppression'])


def process_identity(pid):
    try:
        stat = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return dict(pid=pid, processCreated=f'{int(stat[19]):x}', executable=os.readlink(f'/proc/{pid}/exe'))
    except (OSError, ValueError, IndexError):
        raise Failure('stale-target', 'Accessible process identity cannot be verified')


def make_backend(provider, kind):
    if kind == 'headless':
        raise Failure('capture-unsupported', 'A local X11 or Wayland desktop session is required')
    if kind == 'x11':
        try:
            return provider.Backend()
        except OSError:
            raise Failure('dependency-missing', 'X11 requires libX11.so.6 and libXcomposite.so.1')

    class AccessibleWindows:
        """Own AT-SPI frame handles. They are never interpreted as XIDs."""
        def __init__(self):
            self.frames = {}

        def enumerate(self):
            desktop = provider.Atspi.get_desktop(0)
            windows = []
            if desktop is None:
                return windows
            for i in range(min(desktop.get_child_count(), 2048)):
                app = desktop.get_child_at_index(i)
                for j in range(min(app.get_child_count(), 2048)):
                    frame = app.get_child_at_index(j)
                    if frame.get_role() not in (provider.Atspi.Role.FRAME, provider.Atspi.Role.DIALOG):
                        continue
                    try:
                        old = next((key for key, value in self.frames.items() if value == frame), None)
                        key = old or 'atspi-' + uuid.uuid4().hex
                        self.frames[key] = frame
                        windows.append(self.describe(key))
                    except (Failure, provider.Failure):
                        pass
            return windows

        def describe(self, key):
            frame = self.frames.get(key)
            if frame is None:
                raise Failure('window-closed', 'AT-SPI frame is no longer retained')
            state = frame.get_state_set()
            if state.contains(provider.Atspi.StateType.DEFUNCT) or frame.get_parent() is None:
                self.frames.pop(key, None)
                raise Failure('window-closed', 'AT-SPI frame was closed')
            identity = process_identity(frame.get_process_id())
            if identity['pid'] == os.getpid():
                raise Failure('stale-target', 'Internal indicator is not a target')
            component = frame.get_component_iface()
            rect = component.get_extents(provider.Atspi.CoordType.WINDOW) if component else None
            return dict(identity, hwnd=key, title=frame.get_name() or '', dpi=96,
                        widthPx=max(0, rect.width) if rect else 0,
                        heightPx=max(0, rect.height) if rect else 0,
                        minimized=state.contains(provider.Atspi.StateType.ICONIFIED))

        def verify(self, requested):
            if not isinstance(requested, dict):
                raise Failure('invalid-params', 'Window descriptor required')
            current = self.describe(requested.get('hwnd'))
            if any(current[k] != requested.get(k) for k in ('hwnd', 'pid', 'processCreated', 'executable')):
                raise Failure('stale-target', 'Accessible process identity changed')
            return current

        def geometry(self, window):
            # Only an invalidation token: Wayland provides no screen mapping here.
            return (0, 0, window['widthPx'], window['heightPx'])

    class WaylandBackend(provider.Backend):
        def __init__(self):
            self.x = AccessibleWindows()
            provider.Atspi.set_timeout(1500, 3000)
            self.observation = self.overlay = self.overlay_identity = None
            self.lock = threading.Lock()

        def accessible_root(self, window):
            self.x.verify(window)
            return self.x.frames[window['hwnd']]

        def call(self, method, params):
            if method == 'listWindows':
                return dict(windows=self.x.enumerate())
            if method in ('observe', 'restore', 'resize'):
                raise Failure('unsupported-action', 'Wayland selected-window capture/restore/resize requires compositor support')
            if method == 'status':
                return dict(window=self.x.verify(params.get('window')))
            if method == 'act' and params.get('action') == 'pressKey':
                raise Failure('unsupported-action', 'Wayland backend supports AT-SPI semantic actions; window key injection is unavailable')
            return super().call(method, params)

    return WaylandBackend()


def serve(input_stream=None, emit=None):
    input_stream = input_stream or sys.stdin.buffer
    output_lock = threading.Lock()
    if emit is None:
        def emit(value):
            with output_lock:
                sys.stdout.write(json.dumps(value, ensure_ascii=False) + '\n')
                sys.stdout.flush()
    backend = provider = None
    kind = session_kind()
    while True:
        line = input_stream.readline(16 * 1024 * 1024 + 1)
        if not line:
            return
        rid = None
        try:
            if len(line) > 16 * 1024 * 1024:
                while line and not line.endswith(b'\n'):
                    line = input_stream.readline(65536)
                raise Failure('request-too-large', 'Request exceeds 16 MiB')
            try:
                request = json.loads(line)
            except (ValueError, UnicodeError):
                raise Failure('invalid-request', 'Invalid JSON request')
            if not isinstance(request, dict):
                raise Failure('invalid-request', 'Request object required')
            rid = request.get('id')
            if (set(request) - {'id', 'method', 'params'} or not isinstance(rid, (str, int))
                    or isinstance(rid, bool) or not isinstance(request.get('method'), str)
                    or not isinstance(request.get('params', {}), dict)):
                raise Failure('invalid-request', 'Invalid request envelope')
            method, params = request['method'], request.get('params', {})
            if method == 'shutdown':
                emit(dict(id=rid, result=dict(shutdown=True)))
                return
            if method == 'capabilities':
                # Probe dependencies too; capabilities are never a successful live test.
                if provider is None:
                    provider = load_provider()
                if kind == 'x11':
                    try:
                        provider.C.CDLL('libX11.so.6')
                        provider.C.CDLL('libXcomposite.so.1')
                    except OSError:
                        raise Failure('dependency-missing', 'X11 requires libX11.so.6 and libXcomposite.so.1')
                emit(dict(id=rid, result=capabilities(kind)))
                continue
            if method in ('captureDesktop', 'windowAtPoint', 'actionPoint', 'approvalNotificationShow'):
                raise Failure('unsupported-action', 'This Linux provider does not support desktop input/capture or native notifications')
            if method == 'approvalNotificationHide':
                emit(dict(id=rid, result=dict(hidden=True)))
                continue
            if method == 'overlayHide' and backend is None:
                emit(dict(id=rid, result=dict(hidden=True)))
                continue
            if provider is None:
                provider = load_provider()
            if backend is None:
                provider.emit = emit
                backend = make_backend(provider, kind)
                def gtk_loop():
                    provider.Gtk.init([])
                    provider.Gtk.main()
                threading.Thread(target=gtk_loop, daemon=True).start()
            emit(dict(id=rid, result=backend.call(method, params)))
        except Exception as error:
            known = isinstance(error, Failure) or (provider is not None and isinstance(error, provider.Failure))
            emit(dict(id=rid, error=dict(code=error.code if known else 'native-error',
                                         message=error.message if known else 'Linux window provider operation failed')))


if __name__ == '__main__':
    serve()

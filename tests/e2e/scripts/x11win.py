#!/usr/bin/env python3
"""Tiny X11 window helper for the E2E harness (TEST-ONLY, never shipped).

Under Xvfb there is no window manager and xdotool is not installed, so the
specs need a dependency-free way to (a) close a native dialog the way a WM
would, (b) press Escape into it, and (c) resize the app toplevel. This script
talks to libX11 / libXtst directly through ctypes (both ship with every GTK
desktop), using $DISPLAY.

Usage:
  x11win.py close   <window-id>              # WM_DELETE_WINDOW ClientMessage
  x11win.py escape  <window-id>              # focus + XTest Escape press/release
  x11win.py resize  <window-id> <x> <y> <w> <h>
  x11win.py screen                           # prints "<width> <height>"

<window-id> is decimal or 0x-hex (as printed by xwininfo). Exit 0 on success.
"""
import ctypes
import ctypes.util
import sys

x11 = ctypes.cdll.LoadLibrary(ctypes.util.find_library("X11") or "libX11.so.6")

c_ulong = ctypes.c_ulong
c_long = ctypes.c_long
c_int = ctypes.c_int
c_uint = ctypes.c_uint
c_void_p = ctypes.c_void_p

x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = c_void_p
x11.XCloseDisplay.argtypes = [c_void_p]
x11.XFlush.argtypes = [c_void_p]
x11.XSync.argtypes = [c_void_p, c_int]
x11.XInternAtom.argtypes = [c_void_p, ctypes.c_char_p, c_int]
x11.XInternAtom.restype = c_ulong
x11.XSendEvent.argtypes = [c_void_p, c_ulong, c_int, c_long, c_void_p]
x11.XSendEvent.restype = c_int
x11.XMoveResizeWindow.argtypes = [c_void_p, c_ulong, c_int, c_int, c_uint, c_uint]
x11.XSetInputFocus.argtypes = [c_void_p, c_ulong, c_int, c_ulong]
x11.XKeysymToKeycode.argtypes = [c_void_p, c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
x11.XDefaultScreen.argtypes = [c_void_p]
x11.XDisplayWidth.argtypes = [c_void_p, c_int]
x11.XDisplayHeight.argtypes = [c_void_p, c_int]


class XClientMessageEvent(ctypes.Structure):
    _fields_ = [
        ("type", c_int),
        ("serial", c_ulong),
        ("send_event", c_int),
        ("display", c_void_p),
        ("window", c_ulong),
        ("message_type", c_ulong),
        ("format", c_int),
        ("l", c_long * 5),
    ]


class XEvent(ctypes.Union):
    _fields_ = [("xclient", XClientMessageEvent), ("pad", c_long * 24)]


CLIENT_MESSAGE = 33
XK_ESCAPE = 0xFF1B
REVERT_TO_PARENT = 2


def open_display():
    dpy = x11.XOpenDisplay(None)
    if not dpy:
        sys.stderr.write("x11win: cannot open DISPLAY\n")
        sys.exit(2)
    return dpy


def close(dpy, win):
    ev = XEvent()
    ev.xclient.type = CLIENT_MESSAGE
    ev.xclient.window = win
    ev.xclient.message_type = x11.XInternAtom(dpy, b"WM_PROTOCOLS", 0)
    ev.xclient.format = 32
    ev.xclient.l[0] = x11.XInternAtom(dpy, b"WM_DELETE_WINDOW", 0)
    ev.xclient.l[1] = 0  # CurrentTime
    ok = x11.XSendEvent(dpy, win, 0, 0, ctypes.byref(ev))
    x11.XSync(dpy, 0)
    return ok != 0


def escape(dpy, win):
    xtst = ctypes.cdll.LoadLibrary(ctypes.util.find_library("Xtst") or "libXtst.so.6")
    xtst.XTestFakeKeyEvent.argtypes = [c_void_p, c_uint, c_int, c_ulong]
    x11.XSetInputFocus(dpy, win, REVERT_TO_PARENT, 0)
    x11.XSync(dpy, 0)
    kc = x11.XKeysymToKeycode(dpy, XK_ESCAPE)
    xtst.XTestFakeKeyEvent(dpy, kc, 1, 0)
    xtst.XTestFakeKeyEvent(dpy, kc, 0, 0)
    x11.XSync(dpy, 0)
    return True


def main(argv):
    if len(argv) < 2:
        sys.stderr.write(__doc__)
        return 2
    cmd = argv[1]
    dpy = open_display()
    try:
        if cmd == "screen":
            scr = x11.XDefaultScreen(dpy)
            print(f"{x11.XDisplayWidth(dpy, scr)} {x11.XDisplayHeight(dpy, scr)}")
            return 0
        win = int(argv[2], 0)
        if cmd == "close":
            return 0 if close(dpy, win) else 1
        if cmd == "escape":
            return 0 if escape(dpy, win) else 1
        if cmd == "resize":
            x, y, w, h = (int(v) for v in argv[3:7])
            x11.XMoveResizeWindow(dpy, win, x, y, w, h)
            x11.XSync(dpy, 0)
            return 0
        sys.stderr.write(f"x11win: unknown command {cmd}\n")
        return 2
    finally:
        x11.XCloseDisplay(dpy)


if __name__ == "__main__":
    sys.exit(main(sys.argv))

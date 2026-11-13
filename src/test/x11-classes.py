# The mapped top-level X11 windows: WM_CLASS (instance, class). Used by the app tests.
import ctypes, ctypes.util, json, sys
x = ctypes.cdll.LoadLibrary(ctypes.util.find_library("X11") or "libX11.so.6")
x.XOpenDisplay.restype = ctypes.c_void_p
x.XDefaultRootWindow.restype = ctypes.c_ulong
x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
class ClassHint(ctypes.Structure):
    _fields_ = [("res_name", ctypes.c_char_p), ("res_class", ctypes.c_char_p)]
L = ctypes.c_ulong
class Attrs(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int), ("y", ctypes.c_int), ("width", ctypes.c_int), ("height", ctypes.c_int), ("border_width", ctypes.c_int), ("depth", ctypes.c_int),
                ("visual", ctypes.c_void_p), ("root", L), ("class_", ctypes.c_int), ("bit_gravity", ctypes.c_int), ("win_gravity", ctypes.c_int), ("backing_store", ctypes.c_int),
                ("backing_planes", L), ("backing_pixel", L), ("save_under", ctypes.c_int), ("colormap", L), ("map_installed", ctypes.c_int), ("map_state", ctypes.c_int),
                ("all_event_masks", ctypes.c_long), ("your_event_mask", ctypes.c_long), ("do_not_propagate_mask", ctypes.c_long), ("override_redirect", ctypes.c_int), ("screen", ctypes.c_void_p)]
x.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)), ctypes.POINTER(ctypes.c_uint)]
x.XGetClassHint.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ClassHint)]
x.XFetchName.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_char_p)]
x.XGetWindowAttributes.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p]
d = x.XOpenDisplay(None)
if not d: sys.exit("no display")
root = x.XDefaultRootWindow(d)
r, p, kids, n = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
x.XQueryTree(d, root, ctypes.byref(r), ctypes.byref(p), ctypes.byref(kids), ctypes.byref(n))
out = []
for i in range(n.value):
    w = kids[i]
    a = Attrs()
    x.XGetWindowAttributes(d, w, ctypes.byref(a))
    hint = ClassHint()
    if not x.XGetClassHint(d, w, ctypes.byref(hint)): continue
    name = ctypes.c_char_p()
    x.XFetchName(d, w, ctypes.byref(name))
    mapped = a.map_state == 2
    out.append({"class": [(hint.res_name or b"").decode(), (hint.res_class or b"").decode()], "title": (name.value or b"").decode(), "mapped": mapped})
print(json.dumps([o for o in out if o["mapped"]]))

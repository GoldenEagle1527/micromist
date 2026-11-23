#!/usr/bin/env python3
import os
import sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py")
os.execv(sys.executable, [sys.executable, root, "--game", "explosive-chess", *sys.argv[1:]])

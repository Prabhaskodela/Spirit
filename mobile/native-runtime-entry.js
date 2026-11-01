import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { FileTransfer } from "@capacitor/file-transfer";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";

globalThis.SpiritHUBNative = { Capacitor, App, Browser, Directory, FileTransfer, Filesystem, FileOpener };
export { Capacitor, App, Browser, Directory, FileTransfer, Filesystem, FileOpener };

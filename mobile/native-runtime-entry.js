import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { FileTransfer } from "@capacitor/file-transfer";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { GOOGLE_WEB_CLIENT_ID } from "./native-google-auth-config.js";

const googleAuthReady = GOOGLE_WEB_CLIENT_ID
  ? SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID, mode: "online" } })
  : Promise.resolve();

globalThis.SpiritHUBNative = {
  Capacitor, App, Browser, SocialLogin, googleAuthReady, GOOGLE_WEB_CLIENT_ID,
  Directory, FileTransfer, Filesystem, FileOpener,
};
export { Capacitor, App, Browser, SocialLogin, googleAuthReady, GOOGLE_WEB_CLIENT_ID, Directory, FileTransfer, Filesystem, FileOpener };

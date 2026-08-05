declare module "knayi-myscript" {
  export type MyanmarFontType = "unicode" | "zawgyi" | "wininnwa" | "english" | "en" | string;

  export function setGlobalOptions(options: { silent_mode?: boolean }): void;
  export function fontDetect(value: string): MyanmarFontType;
  export function fontConvert(value: string, target: "unicode" | "zawgyi", source?: MyanmarFontType): string;
}

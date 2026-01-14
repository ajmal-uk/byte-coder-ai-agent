import * as os from 'os';

export class SystemDetector {
    public static getOS(): string {
        const platform = os.platform();
        if (platform === 'darwin') return 'macOS';
        if (platform === 'win32') return 'Windows';
        if (platform === 'linux') return 'Linux';
        return 'Unknown';
    }

    public static getShell(): string {
        const platform = os.platform();
        if (platform === 'win32') return 'cmd.exe / PowerShell';
        if (platform === 'darwin' || platform === 'linux') {
            return process.env.SHELL || '/bin/bash';
        }
        return 'Unknown';
    }

    public static getContextString(): string {
        return `[SYSTEM CONTEXT]\nOS: ${this.getOS()}\nShell: ${this.getShell()}`;
    }
}

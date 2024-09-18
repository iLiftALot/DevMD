import ProjectsHTMLInjector from "main";
import { moment } from "obsidian";


export type PGPConfig = {
    sendingKey: string,
    receivingKeys: string[]
}
export interface HTMLInjectSettings {
    savedMarkdown: string;
    apiKey: string;
    checkboxState: { [key: string]: boolean }; // To store checkbox states by label text
    updateInterval: number;
    nextUpdateTime: string;
    pgpPublicPath: string;
    pgpPrivatePath: string;
    privateKeyPassPhrase: string;
    allKeysPathSetting: string;
    pgpConfig: PGPConfig;
    allPrivateKeysPathSetting: string;
    signMessage: boolean;
    verifyMessage: boolean;
}

// Default settings values
export const DEFAULT_SETTINGS: HTMLInjectSettings = {
    savedMarkdown: '',
    apiKey: '',
    checkboxState: {},
    updateInterval: 1,
    nextUpdateTime: moment().format('YYYY-MM-DDTHH:mm'),
    pgpPublicPath: '',
    pgpPrivatePath: '',
    privateKeyPassPhrase: '',
    allKeysPathSetting: '',
    pgpConfig: { sendingKey: '', receivingKeys: [] },
    allPrivateKeysPathSetting: '',
    signMessage: false,
    verifyMessage: false
}

export class Settings {
	plugin: ProjectsHTMLInjector;

    constructor(plugin: ProjectsHTMLInjector) {
        this.plugin = plugin;
    }

    async loadSettings() {
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, await this.plugin.loadData());
    }

    async saveSettings() {
        await this.plugin.saveData(this.plugin.settings);
    }
}


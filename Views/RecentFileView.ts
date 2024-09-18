import { App, ItemView, WorkspaceLeaf, IconName, TFile, moment } from 'obsidian';
import ProjectsHTMLInjector from '../main';


export class RecentFileView extends ItemView {
    app: App;
    plugin: ProjectsHTMLInjector;
    leaf: WorkspaceLeaf;

    constructor(app: App, plugin: ProjectsHTMLInjector, leaf: WorkspaceLeaf) {
        super(leaf);
        this.app = app;
        this.plugin = plugin;

    }

    getViewType(): string {
        return 'recent-file-view';
    }

    getDisplayText(): string {
        return 'Recent File View';
    }

    getIcon(): IconName {
        return 'file';
    }

    // Add the onOpen method to populate the view when the tab is opened
    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1]; // The main container element for the view

        // Clear previous content
        container.empty();

        // Create a tab bar
        const tabBar = container.createEl('div');
        tabBar.style.display = 'flex';
        tabBar.style.justifyContent = 'center';
        tabBar.style.marginBottom = '10px';
        tabBar.style.gap = '5px';

        const recentFilesTabButton = tabBar.createEl('button', { text: 'Recent Files' });
        const recentlyOpenedTabButton = tabBar.createEl('button', { text: 'Recently Opened Files' });

        const tabContent = container.createEl('div');

        // Switch tab content
        recentFilesTabButton.onclick = () => {
            showRecentFiles();
        };
        recentlyOpenedTabButton.onclick = () => {
            showRecentlyOpenedFiles();
        };

        // Method to refresh and display recent files (based on modification time)
        const showRecentFiles = async () => {
            tabContent.empty(); // Clear tab content

            const recentFiles = this.app.vault.getAllLoadedFiles()
                .filter(file => file instanceof TFile)
                .sort((a, b) => b.stat.mtime - a.stat.mtime)
                .slice(0, 50);

            const listHolder = tabContent.createEl('div');
            listHolder.classList.add('nav-files-container', 'node-insert-event', 'show-unsupported');
            listHolder.style.position = 'relative';

            recentFiles.forEach(file => {
                const list = listHolder.createEl('div');
                list.classList.add('tree-item', 'nav-file');

                const listItem = list.createEl('div');
                listItem.classList.add('tree-item-self', 'is-clickable', 'nav-file-title', 'tappable');
                listItem.setAttr('data-path', file.path);

                const fileLink = listItem.createEl('div', {
                    text: file.basename,
                });
                fileLink.classList.add('tree-item-inner', 'nav-file-title-content');

                const fileEditRelativetime = listItem.createEl('span');
                fileEditRelativetime.setCssStyles({
                    'fontSize': 'medium',
                    'color': 'red',
                    'marginLeft': '15px'
                });
                fileEditRelativetime.textContent = moment(file.stat.mtime).fromNow();

                // Add event listener for file click using Obsidian's internal linking API
                listItem.onclick = async (event: MouseEvent) => {
                    event.preventDefault();
                    await this.app.workspace.openLinkText(file.path, '', false);
                    showRecentFiles(); // Refresh the view after the file is clicked
                };

                // Add hover preview functionality like CMD/Ctrl hover preview
                this.app.metadataCache.trigger('resolve-link', listItem);
            });
        };

        // Method to display recently opened files (from app.workspace.getLastOpenFiles())
        const showRecentlyOpenedFiles = async () => {
            tabContent.empty(); // Clear tab content

            const recentOpenedFiles = this.app.workspace.getLastOpenFiles(); //.slice(0, 10);

            const listHolder = tabContent.createEl('div');
            listHolder.classList.add('nav-files-container', 'node-insert-event', 'show-unsupported');
            listHolder.style.position = 'relative';

            recentOpenedFiles.forEach(filePath => {
                const file = this.app.vault.getAbstractFileByPath(filePath);

                if (file instanceof TFile) {
                    const list = listHolder.createEl('div');
                    list.classList.add('tree-item', 'nav-file');

                    const listItem = list.createEl('div');
                    listItem.classList.add('tree-item-self', 'is-clickable', 'nav-file-title', 'tappable');
                    listItem.setAttr('data-path', file.path);

                    const fileLink = listItem.createEl('div', {
                        text: file.basename,
                    });
                    fileLink.classList.add('tree-item-inner', 'nav-file-title-content');

                    const fileEditRelativetime = listItem.createEl('span');
                    fileEditRelativetime.setCssStyles({
                        'fontSize': 'medium',
                        'color': 'red',
                        'marginLeft': '15px'
                    });
                    fileEditRelativetime.textContent = 'edited ' + moment(file.stat.mtime).fromNow();

                    // Add event listener for file click using Obsidian's internal linking API
                    listItem.onclick = async (event: MouseEvent) => {
                        event.preventDefault();
                        await this.app.workspace.openLinkText(file.path, '', false);
                        showRecentlyOpenedFiles(); // Refresh the view after the file is clicked
                    };

                    // Add hover preview functionality like CMD/Ctrl hover preview
                    this.app.metadataCache.trigger('resolve-link', listItem);
                }
            });
        };

        // Initial tab: Show Recent Files
        showRecentFiles();

        this.app.workspace.on('file-open', async (file: TFile) => {
            await showRecentlyOpenedFiles();
        });
        this.app.workspace.on('layout-change', async () => {
            await showRecentFiles();
        });
    }

    // Optionally, define the onClose method to handle when the view is closed
    async onClose(): Promise<void> {
        // Clean up if necessary
    }
}

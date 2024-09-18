//import camelize from 'camelize-ts'
import { ObsidianFetcher, type RequestParams, type WebFetcher, type WebResponse } from "TodoistFetcher";
import { TodoistApi, Task, AddTaskArgs, Project, UpdateTaskArgs, GetTasksArgs } from '@doist/todoist-api-typescript';
import { App, moment, Modal } from 'obsidian';
import ProjectsHTMLInjector, { TaskView } from 'main';

export type TaskEntry = {
    taskDueString: string,
    taskId: string,
    taskDesc: string
}
export interface UpcomingTask {
    [taskName: string]: TaskEntry
}

export interface LateTask {
    [taskName: string]: TaskEntry
}

export type TaskCollection = {
	closestTaskName: string,
	closestTaskTime: string,
    closestTaskId: string,
	overdueTaskCount: number,
	upcomingTasks: UpcomingTask[],
    lateTasks: LateTask[]
}

export type TaskTrackObject = {
    apiKey: string,
    projectName: string,
    defaultFilter: string,
    defaultQueryPath: string,
    nextTask: TaskCollection,
    upcomingTasks: UpcomingTask[],
    taskData: Task[],
    projectData: Project[],
    overdueTasks: Task[]
}

export class TaskTracker {
    public app: App;
    public plugin: ProjectsHTMLInjector;
    public filterOptions: Record<string, Record<string, string>>;
    public defaultFilter: string;
    public defaultApiPath: string;
    public fetcher: ObsidianFetcher;
    public baseApiLink: string;
    public closestTaskTime: string;
    public closestTaskName: string;
    public closestTaskDesc: string;
    public closestTaskId: string;
    public overDueCount: number;
    public upcomingTasks: UpcomingTask[];
    public lateTasks: LateTask[];
    public todoistApi: TodoistApi;
    public todoistApiCall: typeof TodoistApi;
    public finalTaskData: TaskCollection;
    public taskData: Task[];
    public projectData: Project[];
    public projectName: string;
    public shouldUpate: boolean;
    public TaskTrackerSetting: TaskTrackObject;
    public overDueCollection: Task[];
    public lastUpdate: moment.Moment;
    public nextUpdate: moment.Moment;
    public initializeTasks: Promise<void>;
    private API_KEY: string;
    
    constructor(
        app: App,
        plugin: ProjectsHTMLInjector,
        API_KEY: string = plugin.todoistToken as string,
        projectName: string = 'UMass',
        apiPath: string = '/tasks',
        filter?: string
    ) {
        this.app = app;
        this.plugin = plugin;
        this.API_KEY = API_KEY;
        this.projectName = projectName;
        this.todoistApiCall = TodoistApi;
        this.fetcher = new ObsidianFetcher();
        this.todoistApi = new TodoistApi(this.API_KEY);
        this.nextUpdate = moment(this.plugin.settings.nextUpdateTime);
        this.baseApiLink = 'https://api.todoist.com/rest/v2';
        this.filterOptions = {
            'yearly': {
                'mild': 'due before: January 1',
                'moderate': '(due before: January 1) & !subtask',
                'severe': '(due before: January 1) & !recurring & !subtask'
            },
            'monthly': {
                'mild': 'due before: first day',
                'moderate': '(due before: first day) & !subtask',
                'severe': '14 days & !subtask & !/* & !no date & !@Reminder & !@Weekly-Review | 14 days & !subtask & !no date & (#UMass* | ##UMass*) | !subtask & !/* & !no date & !@Weekly-Review & !@Reminder & overdue | (#UMass* | ##UMass*) & !subtask & !no date & overdue'
                // (14 days & ##UMass* | 14 days & #UMass* | (recurring & ##UMass* | recurring & #UMass*) | overdue & !subtask & !@Reminder & !@Weekly-Review)
                // 14 days & !subtask & !/* & !no date & !@Reminder & !@Weekly-Review | 14 days & !subtask & !/* & !no date & (#UMass* | ##UMass*) | !subtask & !/* & !no date & !@Weekly-Review & !@Reminder & overdue | (#UMass* | ##UMass*) & !subtask & !/* & !no date & overdue
                // 14 days & !subtask & !/* & !no date & !@Reminder & !@Weekly-Review | 14 days & !subtask & !no date & (#UMass* | ##UMass*) | !subtask & !/* & !no date & !@Weekly-Review & !@Reminder & overdue | (#UMass* | ##UMass*) & !subtask & !no date & overdue
            },
            'biweekly': {
                'mild': 'due before: 2 weeks',
                'moderate': '(due before: 2 weeks) & !subtask',
                'severe': '(due before: 2 weeks) & !recurring & !subtask'
            },
            'weekly': {
                'mild': 'due before: 1 week',
                'moderate': '(due before: 1 week) & !subtask',
                'severe': '(due before: 1 week) & !recurring & !subtask'
            },
            'tridaily': {
                'mild': 'due before: 2 days',
                'moderate': '(due before: 2 days) & !subtask',
                'severe': '(due before: 2 days) & !recurring & !subtask'
            },
            'bidaily': {
                'mild': 'due before: 1 day',
                'moderate': '(due before: 1 day) & !subtask',
                'severe': '(due before: 1 day) & !recurring & !subtask'
            },
            'daily': {
                'mild': 'due today',
                'moderate': '(due today) & !subtask',
                'severe': '(due today) & !recurring & !subtask'
            }
        }
        
        this.defaultFilter = filter ?? this.filterOptions.monthly.severe;
        // this.defaultApiPath = apiPath ?? this.taskPaths.tasks.base[0];
        this.taskData = [];
        this.closestTaskTime = '';
        this.closestTaskName = '';
        this.closestTaskId = '';
        this.closestTaskDesc = '';
        this.overDueCount = 0;
        this.upcomingTasks = [];
        this.lateTasks = [];

        this.finalTaskData = {
            closestTaskName: this.closestTaskName,
            closestTaskTime: this.closestTaskTime,
            closestTaskId: this.closestTaskId,
            overdueTaskCount: this.overDueCount,
            upcomingTasks: this.upcomingTasks,
            lateTasks: this.lateTasks
        };

        //this.TaskTrackerSetting = {
        //    apiKey: this.API_KEY,
        //    projectName: this.projectName,
        //    defaultFilter: this.defaultFilter,
        //    defaultQueryPath: this.defaultApiPath,
        //    nextTask: this.finalTaskData,
        //    taskData: this.taskData,
        //    upcomingTasks: this.upcomingTasks,
        //    projectData: this.projectData,
        //    overdueTasks: this.overDueCollection
        //}

        //this.initializeTasks = this.taskInitializer();
    }

    //async taskInitializer() {
    //    this.TaskTrackerSetting.taskData = await this.todoistApi.getTasks();
    //    this.TaskTrackerSetting.projectData = await this.todoistApi.getProjects();
    //    this.TaskTrackerSetting.nextTask = this.getTasks(this.TaskTrackerSetting.taskData);
    //    this.TaskTrackerSetting.upcomingTasks = this.upcomingTasks; // also defined by calling getTasks
    //    this.TaskTrackerSetting.overdueTasks = await this.getOverDueTasks();
    //}

    //isInitialized() {
    //    return this.API_KEY && this.finalTaskData && this.projectData && this.taskData;
    //}

    getLastUpdateTime() {
        const timeNow = moment();
        return timeNow.isAfter(this.plugin.settings.nextUpdateTime);
    }

    async apiGrabber(
        hasNewData: boolean = false,
        filter: string = this.defaultFilter,
        projectName?: string,
        sectionId: string = '',
        label: string = '',
        lang: string = 'en',
        ids: string[] = [],
        queryOptions?: GetTasksArgs
    ) {
        const shouldUpdate = this.getLastUpdateTime();
        const data: Task[] = this.taskData || []; // Ensure taskData is always an array
        const projectId = projectName ? await this.getProjectByName(projectName) : '';

        if (shouldUpdate || !data?.length || hasNewData) {
            if (shouldUpdate && data && data.length) {
                this.upcomingTasks = [];
                this.lateTasks = [];
            }
            //const bindedPath = this.taskPathBinder();
            const options: GetTasksArgs = queryOptions ?? {
                projectId: projectId,
                sectionId: sectionId,
                label: label,
                filter: filter,
                lang: lang,
                ids: ids
            };
            //const params: RequestParams = {
            //    url: `${this.baseApiLink}${bindedPath}`,
            //    method: 'GET',
            //    headers: {
            //        Authorization: `Bearer ${this.API_KEY}`,
            //    },
            //};
            try {
                const response = await this.todoistApi.getTasks(options); //this.fetcher.fetch(params);
                //if (response.statusCode >= 400) {
                //    throw new TodoistApiError(params, response);
                //}
                //console.log(response)
                this.taskData = response; //camelize(JSON.parse(response.body)) as Task[];
                this.plugin.settings.nextUpdateTime = moment().add(this.plugin.updateInterval, 'minutes').format('YYYY-MM-DDTHH:mm');
                await this.plugin.saveSettings();
                this.nextUpdate = moment(this.plugin.settings.nextUpdateTime);
                return this.getTasks(this.taskData);
            } catch (error) {
                console.error(`Error fetching tasks in TaskTracker.apiGrabber: ${error}`); // Re-throw error for handling upstream
            }
        } else {
            return this.taskData;
        }
    }

    taskPathBinder(apiPath?: string | null, filter?: string) {
        let path = apiPath ?? this.defaultApiPath;
        const queryFilter = filter ?? this.defaultFilter;
        path += `?filter=${encodeURIComponent(queryFilter)}`;
        return path;
    }

    async getOverDueTasks() {
        this.overDueCollection = await this.apiGrabber(true, 'overdue & !recurring & !subtask') as Task[];
        return this.overDueCollection;
    }

    async getProjects(): Promise<Project[]> {
        return await this.todoistApi.getProjects();
    }

    async getSections(projectId?: string) {
        return await this.todoistApi.getSections(projectId);
    }

    async getProjectByName(name: string) {
        this.projectData = await this.getProjects();
        const filteredResult = this.projectData.filter((proj) => proj.name.toLowerCase() === name.toLowerCase() || proj.name.toLowerCase().includes(name.toLowerCase()));
        if (filteredResult && filteredResult.length && filteredResult.length >= 1) {
            return filteredResult[0].id;
        } else {
            return '';
        }
    }

    getTasks(tasks: Task[] | null): TaskCollection {
        this.upcomingTasks.splice(0, this.upcomingTasks.length);
        this.lateTasks.splice(0, this.lateTasks.length);
        const taskHolder: Record<string, Record<string, string>> = {};
        const overdueTaskHolder: Record<string, Record<string, string>> = {};
        let overdueTaskCount = 0;
        const currentDateTime = new Date();
        const allTasks = tasks ?? this.taskData;
        for (const task of allTasks) {
            if (!(task.isCompleted)) {
                const taskID: string = task.id;
                const taskName: string | null = task.content ?? null;
                let dueDateTime = task?.due && task?.due?.datetime 
                        ? task.due.datetime 
                        : (task.due?.date ?? null);

                if (dueDateTime) {
                    if (!task.due?.datetime) dueDateTime = moment(task.due?.date).endOf('day').format('YYYY-MM-DDTHH:mm:ss');
                    const taskDate: Date = new Date(dueDateTime);
                    if (taskDate >= currentDateTime && taskName) {
                        taskHolder[taskName] = {
                            taskDueString: dueDateTime,
                            taskId: taskID,
                            taskDescription: task.description
                        }
                    } else if (taskDate <= currentDateTime && taskName) {
                        overdueTaskHolder[taskName] = {
                            taskDueString: dueDateTime,
                            taskId: taskID,
                            taskDescription: task.description
                        }
                        overdueTaskCount++;
                    }
                }
            }
        }
        this.overDueCount = overdueTaskCount;
        const sortedTasks = Object.entries(taskHolder)
            .sort(([a, b], [c, d]) => {
                const bDate = new Date(b.taskDueString).getTime();
                const dDate = new Date(d.taskDueString).getTime();
                return bDate - dDate;
            });
        sortedTasks.forEach(task => {
            const name = task[0];
            const value = task[1];
            const dueString = value.taskDueString;
            const id = value.taskId;
            const desc = value.taskDescription;
            const newTaskEntry: TaskEntry = {
                taskDueString: dueString,
                taskId: id,
                taskDesc: desc
            };
            const newUpcomingTask: UpcomingTask = {
                [name]: newTaskEntry
            };
            this.upcomingTasks.push(newUpcomingTask);
        });

        const sortedOverdueTasks = Object.entries(overdueTaskHolder)
            .sort(([a, b], [c, d]) => {
                const bDate = new Date(b.taskDueString).getTime();
                const dDate = new Date(d.taskDueString).getTime();
                return bDate - dDate;
            });
        sortedOverdueTasks.forEach(task => {
            const name = task[0];
            const value = task[1];
            const dueString = value.taskDueString;
            const id = value.taskId;
            const desc = value.taskDescription;
            const newTaskEntry: TaskEntry = {
                taskDueString: dueString,
                taskId: id,
                taskDesc: desc
            };
            const newLateTask: UpcomingTask = {
                [name]: newTaskEntry
            };
            this.lateTasks.push(newLateTask);
        });

        this.closestTaskName = sortedTasks[0] ? sortedTasks[0][0] : 'N/A';
        this.closestTaskTime = sortedTasks[0] ? sortedTasks[0][1].taskDueString : 'N/A';
        this.closestTaskId = sortedTasks[0] ? sortedTasks[0][1].taskId : 'N/A';
        this.closestTaskDesc = sortedTasks[0] ? sortedTasks[0][1].taskDescription : 'N/A';

        this.finalTaskData = {
            closestTaskName: this.closestTaskName,
            closestTaskTime: this.closestTaskTime,
            closestTaskId: this.closestTaskId,
            overdueTaskCount: this.overDueCount,
            upcomingTasks: this.upcomingTasks,
            lateTasks: this.lateTasks
        }
        return this.finalTaskData;
    }

    getWeekNumber(d: Date): number {
        // Create a copy of the date object
        const date: Date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        // Set to the nearest Thursday: current date + 4 - current day number
        // Make Sunday's day number 7
        date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
        // Get first day of year
        const yearStart: Date = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        // Calculate full weeks to nearest Thursday
        const weekNo: number = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return weekNo;
    }
    // Function to format the date as YYYY-MM-DD
    formatDate(d: Date): string {
        const year: number = d.getFullYear();
        const month: string = String(d.getMonth() + 1).padStart(2, '0');
        const day: string = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getRelativeTimeString(date: string) {
        const now = moment();
        const taskDate = moment(date);

        if (taskDate.isSameOrAfter(moment())) {
            if (taskDate.isSame(now, 'day')) {
                //return `TODAY ${taskDate.format('HH:mm')}`;
                return `TODAY ${taskDate.fromNow(false)}`;
            } else if (taskDate.isSame(now.add(1, 'day'), 'day')) {
                return `TOMORROW (${taskDate.format('HH:mm')})`;
            } else if (taskDate.isSame(now, 'week')) {
                return `THIS ${taskDate.format('dddd').toUpperCase()} ${taskDate.format('HH:mm')}`;
            } else if (taskDate.isSame(now.add(1, 'weeks'), 'week')) {
                return `NEXT WEEK ${taskDate.format('dddd').toUpperCase()} ${taskDate.format('HH:mm')}`;
            } else {
                return taskDate.format('MMM DD, YYYY HH:mm');
            }
        } else {
            if (taskDate.isSame(now, 'day')) {
                return `TODAY ${taskDate.fromNow(false)}; (${taskDate.format('HH:mm')})`;
            } else if (taskDate.isSame(now.subtract(1, 'day'), 'day')) {
                return `YESTERDAY ${taskDate.fromNow(false)}; (${taskDate.format('HH:mm')})`;
            } else if (taskDate.isSame(now, 'week')) {
                return `LAST ${taskDate.format('dddd').toUpperCase()} ${taskDate.format('HH:mm')}`;
            } else if (taskDate.isSame(now.subtract(1, 'weeks'), 'week')) {
                return `LAST WEEK ${taskDate.format('dddd')} ${taskDate.format('HH:mm')}`;
            } else {
                return taskDate.format('MMM DD, YYYY HH:mm');
            }

        }
    }
}

type AllowedDurationUnit = 'minute' | 'day';

export class TaskModal extends Modal {
    app: App;
    taskName: string;
    taskDescription: string;
    taskDueDate: string;
    taskTracker: TaskTracker;
    plugin: ProjectsHTMLInjector;
    todoistApi: TodoistApi;
    taskDuration: number;
    taskDurationUnit: AllowedDurationUnit;
    selectedProjectId: string;
    taskPriority: number;
    taskView: TaskView | null;
    shouldConvertHours: boolean;
    private API_KEY: string | undefined;

    constructor(app: App, plugin: ProjectsHTMLInjector) {
        super(app);
        this.app = app;
        this.taskName = '';
        this.taskDescription = '';
        this.taskDueDate = '';
        this.selectedProjectId = '';
        this.taskDuration = 30;
        this.taskDurationUnit = 'minute';
        this.taskPriority = 4;
        this.plugin = plugin;
        this.API_KEY = this.plugin.settings.apiKey;
        this.taskView = null;
        this.shouldConvertHours = false;
        if (this.API_KEY) {
            this.todoistApi = plugin.todoistApi ?? new TodoistApi(this.API_KEY);
        }
    }

    async onOpen() {
        const {contentEl} = this;
        await this.plugin.todoistInitializor?.apiGrabber();

        contentEl.createEl('h1', {text: 'Create New Task'});

        const taskNameInput = contentEl.createEl('input', {type: 'text', placeholder: 'Task Name'}) as HTMLInputElement;
        taskNameInput.addClass('task-modal-input');
        taskNameInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (target) this.taskName = target.value;
        });

        contentEl.createEl('h6', {text: 'Description'});

        const taskDescriptionInput = contentEl.createEl('textarea', {placeholder: 'Task Description'});
        taskDescriptionInput.addClass('task-modal-input');
        taskDescriptionInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (target) this.taskDescription = target.value;
        });

        contentEl.createEl('h6', {text: 'Due Date & Time'});

        // Create a container div for the date, duration, and duration unit inputs
        const dateTimeRow = contentEl.createEl('div');
        dateTimeRow.addClass('task-modal-row');

        const taskDueDateInput = contentEl.createEl('input', {type: 'datetime-local'});
        taskDueDateInput.addClass('task-modal-input');
        taskDueDateInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (target) this.taskDueDate = target.value;
        });

        const taskDurationInput = contentEl.createEl('input', { type: 'number', placeholder: 'Duration' }) as HTMLInputElement;
        taskDurationInput.addClass('task-modal-input');
        taskDurationInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (target) {
                if (this.shouldConvertHours) {
                    this.taskDuration = parseInt(target.value) * 60;
                    this.shouldConvertHours = false;
                } else {
                    this.taskDuration = parseInt(target.value);
                }
                //console.log(`handled duration: ${this.taskDuration}`);
            }
        });

        const taskDurationUnitSelect = contentEl.createEl('select') as HTMLSelectElement;
        const unitOptions = ['minute', 'hour', 'day'];
        unitOptions.forEach(optionValue => {
            const option = contentEl.createEl('option', { text: optionValue, value: optionValue === 'hour' ? 'minute' : optionValue });
            taskDurationUnitSelect.appendChild(option);
        });
        taskDurationUnitSelect.addClass('task-modal-input');
        taskDurationUnitSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement | null;
            if (target) {
                this.taskDurationUnit = target.value as AllowedDurationUnit; //=== 'hour' ? 'minute' : target.value as AllowedDurationUnit;
                const selectedOption = target.options[target.selectedIndex].text;
                if (selectedOption === 'hour') {
                    //console.log(selectedOption + '<= its hour :)');
                    this.shouldConvertHours = true;
                } else {
                    //console.log(selectedOption + '<= its not hour :(');
                    this.shouldConvertHours = false;
                }
            }
        });

        dateTimeRow.appendChild(taskDueDateInput);
        dateTimeRow.appendChild(taskDurationInput);
        dateTimeRow.appendChild(taskDurationUnitSelect);

        contentEl.createEl('h6', {text: ' Task Priority & Project Assignment'});

        // Create a container div for the date, duration, and duration unit inputs
        const taskDetailRow = contentEl.createEl('div');
        taskDetailRow.addClass('task-modal-row');

        const taskProjectSelection = contentEl.createEl('select') as HTMLSelectElement;
        taskProjectSelection.addClass('task-modal-input');
        // Populate the select element with projects and their children
        this.populateProjectsDropdown(taskProjectSelection);
        taskProjectSelection.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement | null;
            if (target) this.selectedProjectId = target.value;
        });

        const taskPrioritySelection = contentEl.createEl('select') as HTMLSelectElement;
        const priorityOptions = [4, 3, 2, 1];
        // Create a default "None" option
        const defaultPriorityOption = document.createElement('option');
        defaultPriorityOption.value = '';
        defaultPriorityOption.textContent = 'Select a Priority';
        taskPrioritySelection.appendChild(defaultPriorityOption);
        priorityOptions.forEach(priorityValue => {
            const option = contentEl.createEl('option', { text: String(priorityValue), type: 'number' });
            taskPrioritySelection.appendChild(option);
        });
        taskPrioritySelection.addClass('task-modal-input');
        taskPrioritySelection.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement | null;
            if (target) this.taskPriority = Number(target.value !== '' ? target.value : '4');
        });

        taskDetailRow.appendChild(taskPrioritySelection);
        taskDetailRow.appendChild(taskProjectSelection);

        const submitBtn = contentEl.createEl('button', { text: 'Submit' });
        submitBtn.addClass('task-modal-submit');
        submitBtn.onclick = async () => {
            if (this.shouldConvertHours) {
                this.taskDuration = this.taskDuration * 60;
                this.shouldConvertHours = false;
            }
            //console.log(`duration: ${this.taskDuration}`);

            const taskArgs = {
                content: this.taskName,
                description: this.taskDescription,
                projectId: this.selectedProjectId ,
                priority: this.taskPriority,
                dueString: this.taskDueDate,
                duration: this.taskDuration,
                durationUnit: this.taskDurationUnit
            }

            // console.log(Object.entries(taskArgs));
            const task = await this.taskAdd(taskArgs);
            // console.log(task);
            this.close(); // Close the modal after submission
            if (this.plugin.taskView !== null && this.plugin.taskView instanceof TaskView) await this.plugin.taskView.reloadAll();
        };

        const cancelBtn = contentEl.createEl('button', {text: 'Cancel'});
        cancelBtn.addClass('task-modal-cancel');
        cancelBtn.onclick = () => {
            this.close();
        };
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }

    async extractProjects() {
        const projects = await this.todoistApi.getProjects();
        return projects;
    }

    async taskAdd(taskDetails: AddTaskArgs) {
        const task = await this.todoistApi.addTask(taskDetails);
        return task;
    }

    addProjectsToDropdown(
        taskProjectSelection: HTMLSelectElement,
        projects: Project[], parentId: string | null = null,
        indentLevel: number = 0
    ) {
        const filteredProjects = projects.filter(p => p.parentId === parentId);

        filteredProjects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id; // Use project ID as the value

            // Add indentation based on the level in the hierarchy
            let optionText = `${'—'.repeat(indentLevel)} ${project.name}`;

            // Highlight favorite projects
            if (project.isFavorite) {
                option.style.fontWeight = 'bold';
                option.style.color = 'gold';
                optionText = `⭐ ${optionText.trim()}`;
            }

            option.textContent = optionText;
            taskProjectSelection.appendChild(option);

            // Recursively add children with increased indentation
            this.addProjectsToDropdown(taskProjectSelection, projects, project.id, indentLevel + 1);
        });
    }

    // Retrieve and populate the dropdown with projects and their children
    async populateProjectsDropdown(taskProjectSelection: HTMLSelectElement) {
        const projects = await this.extractProjects();

        // Create a default "None" option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a Project';
        taskProjectSelection.appendChild(defaultOption);

        // Start by adding top-level projects (those with no parent)
        this.addProjectsToDropdown(taskProjectSelection, projects);
    }

    // Method to fetch and populate the select element with projects
    async populateProjectSelection(taskProjectSelection: HTMLSelectElement) {
        const projects = await this.extractProjects();

        // Clear any existing options in the select element
        taskProjectSelection.innerHTML = '';

        // Create a default "None" option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a Project';
        taskProjectSelection.appendChild(defaultOption);

        // Populate the select element with projects
        projects
            .sort((a, b) => {
                    // First, prioritize favorites
                    if (a.isFavorite && !b.isFavorite) return -1; // `a` is a favorite, `b` is not
                    if (!a.isFavorite && b.isFavorite) return 1;  // `b` is a favorite, `a` is not

                    // If both are either favorites or non-favorites, sort by name
                    return a.name.localeCompare(b.name);
                }
            )
            .forEach(project => {
                const option = document.createElement('option');
                option.value = project.id; // Use project ID as the value
                option.textContent = project.name; // Use project name as the display text

                // Highlight the favorite projects
                if (project.isFavorite) {
                    option.style.fontWeight = 'bold'; // Bold the text
                    option.style.color = 'gold'; // Change text color to gold
                    option.textContent = `⭐ ${project.name}`; // Add a star icon before the name
                }

                taskProjectSelection.appendChild(option);
            }
        );
    }
}

export class TaskViewer extends Modal {
    app: App;
    plugin: ProjectsHTMLInjector;
    todoistApi: TodoistApi;
    taskDetails: Task;
    taskName: string;
    taskDescription: string;
    taskDateTime: string;
    taskString: string;
    taskDuration: number;
    taskDurationUnit: string;
    taskId: string;
    selectedProjectId: string;
    taskPriority: number;
    taskCommentCount: number;
    taskCreatedAt: string;
    taskCreatorId: string;
    taskUrl: string;
    taskIsCompleted: boolean;
    taskLabels: string[];
    taskOrder: number;
    taskIsRecurring: boolean;
    taskDate: string;
    shouldConvertHours: boolean;
    shouldConvertMinutes: boolean;
    isTaskDateTimed: boolean;
    private API_KEY: string | undefined;

    constructor(app: App, plugin: ProjectsHTMLInjector, taskDetails: Task) {
        super(app);
        this.app = app;
        this.plugin = plugin;
        this.shouldConvertHours = false;
        this.shouldConvertMinutes = false;
        this.API_KEY = this.plugin.todoistToken;
        if (this.API_KEY) this.todoistApi = new TodoistApi(this.API_KEY);

        this.taskDetails = taskDetails;
        this.taskName = taskDetails.content;
        this.taskDescription = taskDetails.description;
        // Determine if the task is timed (has a specific datetime)
        this.isTaskDateTimed = taskDetails.due?.datetime !== null && taskDetails.due?.datetime !== undefined;
        if (!this.isTaskDateTimed) {
            // If the task is not timed, set the datetime to the end of the day for the provided date
            this.taskDateTime = moment(taskDetails.due?.date).endOf('day').format('YYYY-MM-DDTHH:mm:ss');
        } else {
            // If the task is timed, use the provided datetime
            this.taskDateTime = taskDetails.due?.datetime as string;
        }
        // Set the task date to the provided date or the current date if not provided
        this.taskDate = taskDetails.due?.date ?? moment().format('YYYY-MM-DD');
        // Determine if the task is recurring
        this.taskIsRecurring = taskDetails.due?.isRecurring ?? false;
        // Use the provided string for the task or fallback to taskDateTime
        this.taskString = taskDetails.due?.string ?? this.taskDateTime;
        // Log task details for debugging
        //if (taskDetails.due?.string) {
        //    console.log(`${this.taskString} === ${taskDetails.due.string}`);
        //}
        //console.log(JSON.stringify(taskDetails, null, 4));
        this.selectedProjectId = taskDetails.projectId;
        this.taskDuration = taskDetails.duration?.amount ?? 30;
        this.taskDurationUnit = taskDetails.duration?.unit ?? 'minute';
        this.taskPriority = taskDetails.priority;
        this.taskUrl = taskDetails.url;
        this.taskId = taskDetails.id;
        this.taskCommentCount = taskDetails.commentCount;
        this.taskCreatedAt = taskDetails.createdAt;
        this.taskCreatorId = taskDetails.creatorId;
        this.taskIsCompleted = taskDetails.isCompleted;
        this.taskLabels = taskDetails.labels;
        this.taskOrder = taskDetails.order;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        await this.displayOnOpen(contentEl);
    }

    async taskEdit(taskId: string, taskArgs: UpdateTaskArgs) {
        return this.todoistApi.updateTask(taskId, taskArgs);
    }

    convertMinutesToHours(totalMins: number) {
            const leftoverMins = totalMins % 60;
            const hours = (totalMins - leftoverMins) / 60;
            return { leftoverMins: leftoverMins, hours: hours };
    }

    async displayOnOpen(contentEl: HTMLElement) {
        const mainContainer = contentEl.createEl('div');

        const headerColumn = contentEl.createEl('div');
        headerColumn.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column'
        });
        const valueColumn = contentEl.createEl('div');
        valueColumn.setCssStyles({
            'display': 'flex',
            'flexDirection': 'column'
        });

        const taskNameIsLink = this.taskName.match(/(?<=\[).+(?=\]\(.+?\))/g);
        const linkUrlMatch = this.taskName.match(/(?<=\]\().+?(?=\))/g);

        let mainHeading: HTMLElement;
        if (taskNameIsLink && linkUrlMatch) {
            // If the task name is a link, create a clickable heading
            mainHeading = contentEl.createEl('h1');
            const anchor = mainHeading.createEl('a', { href: linkUrlMatch[0], text: taskNameIsLink[0] });
            anchor.setAttrs({
                'target': '_blank', // Opens the link in a new tab
            });
        } else {
            // If it's not a link, create a regular heading
            mainHeading = contentEl.createEl('h1', { text: this.taskName });
        }

        const taskDescHasLink = this.taskDescription.match(/(?<=\[).+(?=\]\(.+?\))/gm);
        const taskDescEntireLink = this.taskDescription.match(/\[.+\]\(.+?\)/gm);
        const descLinkUrlMatch = this.taskDescription.match(/(?<=\]\().+?(?=\))/gm);

        let descriptionValue: any = null;
        if (taskDescHasLink && descLinkUrlMatch && taskDescEntireLink) {
            descriptionValue = contentEl.createEl('span');
            descriptionValue.innerHTML = `<span>${this.taskDescription.replace(
                taskDescEntireLink[0],
                '<a href="' + descLinkUrlMatch[0] + '" target="_blank">' + taskDescHasLink[0] + '</a>'
            )}</span>`;
            descriptionValue.setCssStyles({
                'whiteSpace': 'pre-line',
            });
        } else if (this.taskDescription) {
            // If it's not a link, create a regular heading
            descriptionValue = contentEl.createEl('span', { text: this.taskDescription });
        }

        const descriptionHeader = this.taskDescription !== '' ? contentEl.createEl('h3', {text: 'Description'}) : null as any;
        const priorityHeading = contentEl.createEl('h3', {text: 'Priority'});
        const priorityText = contentEl.createEl('span', {text: String(this.taskPriority)});
        const dueHeading = contentEl.createEl('h3', {text: 'Due Date'});
        const dueText = contentEl.createEl('span', { text: moment(this.taskDateTime).format('ddd MMM DD, YYYY HH:mm') });
        const durAmount = this.taskDuration;
        const durUnit = durAmount > 1 ? this.taskDurationUnit + 's' : this.taskDurationUnit;
        const taskDateTime = this.taskDateTime;
        const momentStart = moment(taskDateTime);
        // Format the start time in HH:mm format
        const start = momentStart.format('HH:mm');
        // Add duration to get the end time, adjust durAmount and durUnit as needed
        const end = momentStart.add(durAmount, durUnit as 'minute' | 'hour').format('HH:mm');
        // console.log(`ST ${start} EN ${end} MmSt ${momentStart} DDD ${this.taskDetails.due?.datetime}\n\n${JSON.stringify(this.taskDetails, null, 4)}`);
        const timeCompareString = `${start} - ${end} `;

        let durationString = this.isTaskDateTimed ? `${timeCompareString} (${durAmount} ${durUnit})` : null;
        if (durUnit.contains('minute') && durAmount >= 60 && durationString) {
            this.taskDurationUnit = 'hour';
            const totalMins = durAmount;
            const { leftoverMins, hours } = this.convertMinutesToHours(totalMins);
            durationString = `${timeCompareString} (${hours} hour${hours > 1 ? 's' : ''}${leftoverMins !== 0 ? ' and ' + leftoverMins + ' minute' + (leftoverMins > 1 ? 's' : '') : ''})`;
        }

        //console.log(this.isTaskDateTimed)
        
        const durationHeading = this.isTaskDateTimed ? contentEl.createEl('h3', {text: 'Duration'}) : null;
        const durationText = durationString ? contentEl.createEl('span', { text: durationString }) : null;

        const headerList: HTMLHeadingElement[] = [descriptionHeader, priorityHeading, dueHeading, durationHeading].filter(p => p instanceof HTMLHeadingElement); // filter the null values if any
        const valueList: HTMLSpanElement[] = [descriptionValue, priorityText, dueText, durationText].filter(p => p instanceof HTMLSpanElement); // filter the null values if any

        const projectDetails = await this.todoistApi.getProject(this.selectedProjectId);
        // console.log(`PROJECT NAME: ${projectDetails.name}`);
        let projectHeader: HTMLHeadingElement | undefined = undefined;
        let projectNameSpan: HTMLSpanElement | undefined = undefined;
        if (projectDetails.name !== 'Inbox') {
            projectHeader = contentEl.createEl('h3', { text: 'Project' });
            projectNameSpan = contentEl.createEl('span');
            projectNameSpan.textContent = projectDetails.name;
            headerList.push(projectHeader);
            valueList.push(projectNameSpan);
        }

        const btnDiv = contentEl.createEl('div');
        btnDiv.setCssStyles({
            'display': 'flex',
            'justifyContent': 'center'
        })

        const closeBtn = contentEl.createEl('button', { 'text': 'Close' });
        closeBtn.onclick = async () => {
            this.close();
        }
        const editBtn = contentEl.createEl('button', { 'text': 'Edit' });
        editBtn.onclick = async () => {
            await this.handleEditTask(contentEl);
        }
        const copyBtn = contentEl.createEl('button', { 'text': 'Copy Content' });
        // Function to construct the clipboard text in the desired format
        copyBtn.onclick = async () => {
            // Assuming you have access to these values, construct the string for the clipboard
            const taskContent = [
                `Task Name: ${this.taskName}`,
                `Description: ${this.taskDescription}`,
                `Priority: ${this.taskPriority}`,
                `Due Date: ${this.taskString}`,//moment(this.taskString).format('ddd MMM DD, YYYY HH:mm')}`,
                `Duration: ${durationString}`,
            ].join('\n'); // Join each line with a newline character

            // Copy constructed content to the clipboard
            await navigator.clipboard.writeText(taskContent);
        };

        btnDiv.append(editBtn, copyBtn, closeBtn);

        contentEl.prepend(mainHeading);

        for (let i = 0; i < headerList.length; i++) {
            const headerEl: HTMLHeadingElement = headerList[i];
            const valueEl: HTMLSpanElement = valueList[i];
            const rowDiv = contentEl.createEl('div');
            rowDiv.setCssStyles({
                'display': 'flex',
                'alignItems': 'center',
                'gap': '20px',
                'margin': '0px',
                //'width': 'fit-content'
            })
            rowDiv.append(headerEl, valueEl);
            mainContainer.appendChild(rowDiv);
        }
        contentEl.appendChild(mainContainer);
        contentEl.appendChild(btnDiv);
        this.contentEl.classList.add('task-viewer')
        this.contentEl.setCssStyles({
            'userSelect': 'auto',
        })
    }

    async handleEditTask(contentEl: HTMLElement) {
        contentEl.innerHTML = '';
        contentEl.createEl('h1', {text: 'Create New Task'});

        //console.log(`TASK DURATION: ${Object.entries(this.taskDetails?.duration ?? {})}`);

        const taskNameInput = contentEl.createEl('input', {type: 'text', placeholder: 'Task Name'}) as HTMLInputElement;
        taskNameInput.value = this.taskName;
        taskNameInput.addClass('task-modal-input');
        taskNameInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (target) this.taskName = target.value;
        });

        contentEl.createEl('h6', {text: 'Description'});

        const taskDescriptionInput = contentEl.createEl('textarea', {placeholder: 'Task Description'});
        taskDescriptionInput.value = this.taskDescription;
        taskDescriptionInput.addClass('task-modal-input');
        taskDescriptionInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (target) this.taskDescription = target.value;
        });

        contentEl.createEl('h6', {text: 'Due Date & Time'});

        // Create a container div for the date, duration, and duration unit inputs
        const dateTimeRow = contentEl.createEl('div');
        dateTimeRow.addClass('task-modal-row');
        dateTimeRow.setCssStyles({
            'display': 'flex',
        })

        const taskDueDateInput = contentEl.createEl('input', {type: 'datetime-local'});
        taskDueDateInput.value = this.taskString; // full string of inputted date
        taskDueDateInput.addClass('task-modal-input');
        taskDueDateInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (target) this.taskString = target.value;
        });

        const taskDurationInput = contentEl.createEl('input') as HTMLInputElement;
        const taskDurationUnitSelect = contentEl.createEl('select') as HTMLSelectElement;

        taskDurationInput.type = 'number';
        taskDurationInput.addClass('task-modal-input');
        taskDurationInput.setCssStyles({
            width: '75%',
            textAlign: 'center',
            fontSize: '25px'
        })
        taskDurationInput.setAttr('aria-label', 'Input the duration corresponding to the unit in the next field.');

        const unitOptions = ['minute', 'hour', 'day'];
        unitOptions.forEach(optionValue => {
            const option = contentEl.createEl('option', { text: optionValue, value: optionValue === 'hour' ? 'minute' : optionValue });
            taskDurationUnitSelect.appendChild(option);
        });
        taskDurationUnitSelect.addClass('task-modal-input');

        let converted = false;
        if (this.taskDuration >= 60 && this.taskDurationUnit === 'hour') { // convert time measurement minutes > hours 
            this.taskDuration = Number((this.taskDuration / 60).toFixed(1));
            converted = true;
        } 
        taskDurationInput.value = String(this.taskDuration);
    
        // Iterate through the options and select the one with the text 'hour'
        for (let i = 0; i < taskDurationUnitSelect.options.length; i++) {
            if (taskDurationUnitSelect.options[i].text === this.taskDurationUnit) {
                taskDurationUnitSelect.selectedIndex = i;  // Set the initial selection by index
                break;  // Exit the loop once the desired option is found
            }
        }

        taskDurationInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (target) {
                const inputValue = target.valueAsNumber;
                if (this.shouldConvertHours && !converted) { 
                    this.taskDuration = inputValue * 60; // Convert hours to minutes
                    this.shouldConvertHours = false;  // Reset the flag after conversion
                } else if (this.shouldConvertMinutes && converted) {
                        this.taskDuration = inputValue / 60;  // Keep minutes as they are
                        this.shouldConvertMinutes = false;  // Reset the flag after conversion
                } else {
                    this.taskDuration = inputValue; // Direct assignment if no conversion is needed (`day` duration unit) 
                }
            }
        });
        taskDurationUnitSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement | null;
            if (target) {
                this.taskDurationUnit = target.options[target.selectedIndex].text;
                const selectedOption = target.value;
                // Adjust conversion flags based on the selected option
                if (this.taskDurationUnit === 'hour' && !converted && selectedOption === 'minute') { // hour format not yet converted to hours * 60 calculation
                        this.shouldConvertHours = true;  // Set to true if moving from minutes to hours
                        this.shouldConvertMinutes = false;
                } else if (this.taskDurationUnit === 'minute' && converted && selectedOption === 'minute') { // minute format not yet converted to hours / 60 calculation
                        this.shouldConvertMinutes = false;  // Set to true if moving from hours to minutes
                        this.shouldConvertHours = true;
                }else {
                    this.shouldConvertHours = false;
                    this.shouldConvertMinutes = false;
                }
            }
        });

        dateTimeRow.appendChild(taskDueDateInput);
        dateTimeRow.appendChild(taskDurationInput);
        dateTimeRow.appendChild(taskDurationUnitSelect);

        contentEl.createEl('h6', { text: ' Task Priority & Project Assignment' });

        // Create a container div for the date, duration, and duration unit inputs
        const taskDetailRow = contentEl.createEl('div');
        taskDetailRow.addClass('task-modal-row');

        const taskProjectSelection = contentEl.createEl('select') as HTMLSelectElement;
        taskProjectSelection.addClass('task-modal-input');
        // Populate the select element with projects and their children
        await this.populateProjectsDropdown(taskProjectSelection);
        taskProjectSelection.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement | null;
            if (target) this.selectedProjectId = target.value;
        });
        taskProjectSelection.value = this.selectedProjectId;

        const taskPrioritySelection = contentEl.createEl('select') as HTMLSelectElement;
        const priorityOptions = [4, 3, 2, 1];
        // Create a default "None" option
        const defaultPriorityOption = document.createElement('option');
        defaultPriorityOption.value = '';
        defaultPriorityOption.textContent = 'Select a Priority';
        taskPrioritySelection.appendChild(defaultPriorityOption);
        priorityOptions.forEach(priorityValue => {
            const option = contentEl.createEl('option', { text: String(priorityValue), type: 'number' });
            taskPrioritySelection.appendChild(option);
        });
        taskPrioritySelection.addClass('task-modal-input');
        taskPrioritySelection.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement | null;
            if (target) this.taskPriority = Number(target.value !== '' ? target.value : '4');
        });
        taskPrioritySelection.value = String(this.taskPriority);

        taskDetailRow.appendChild(taskPrioritySelection);
        taskDetailRow.appendChild(taskProjectSelection);

        const submitBtn = contentEl.createEl('button', { text: 'Update' });
        submitBtn.addClass('task-modal-submit');
        submitBtn.onclick = async () => {
            //console.log(`duration: ${this.taskDuration}`);
            //console.log(`unit: ${this.taskDurationUnit}`);
            const updateTaskArgs = this.getUpdateTaskObject();
            //console.log(Object.entries(updateTaskArgs));
            const task = await this.taskEdit(this.taskId, updateTaskArgs);
            //console.log(task);
            this.close(); // Close the modal after submission
            if (this.plugin.taskView !== null && this.plugin.taskView instanceof TaskView) await this.plugin.taskView.reloadAll();
        };

        const cancelBtn = contentEl.createEl('button', {text: 'Cancel'});
        cancelBtn.addClass('task-modal-cancel');
        cancelBtn.onclick = async () => {
            const task = await this.todoistApi.getTask(this.taskId); // 
            this.close();
            new TaskViewer(this.app, this.plugin, task).open();
        };
    }

    async extractProjects() {
        const projects = await this.todoistApi.getProjects();
        return projects;
    }

    addProjectsToDropdown(
        taskProjectSelection: HTMLSelectElement,
        projects: Project[], parentId: string | null = null,
        indentLevel: number = 0
    ) {
        const filteredProjects = projects.filter(p => p.parentId === parentId);

        filteredProjects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id; // Use project ID as the value

            // Add indentation based on the level in the hierarchy
            let optionText = `${'—'.repeat(indentLevel)} ${project.name}`;

            // Highlight favorite projects
            if (project.isFavorite) {
                option.style.fontWeight = 'bold';
                option.style.color = 'gold';
                optionText = `⭐ ${optionText.trim()}`;
            }

            option.textContent = optionText;
            taskProjectSelection.appendChild(option);

            // Recursively add children with increased indentation
            this.addProjectsToDropdown(taskProjectSelection, projects, project.id, indentLevel + 1);
        });
    }

    // Retrieve and populate the dropdown with projects and their children
    async populateProjectsDropdown(taskProjectSelection: HTMLSelectElement) {
        const projects = await this.extractProjects();

        // Create a default "None" option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a Project';
        taskProjectSelection.appendChild(defaultOption);

        // Start by adding top-level projects (those with no parent)
        this.addProjectsToDropdown(taskProjectSelection, projects);
    }

    // Method to fetch and populate the select element with projects
    async populateProjectSelection(taskProjectSelection: HTMLSelectElement) {
        const projects = await this.extractProjects();

        // Clear any existing options in the select element
        taskProjectSelection.innerHTML = '';

        // Create a default "None" option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a Project';
        taskProjectSelection.appendChild(defaultOption);

        // Populate the select element with projects
        projects
            .sort((a, b) => {
                    // First, prioritize favorites
                    if (a.isFavorite && !b.isFavorite) return -1; // `a` is a favorite, `b` is not
                    if (!a.isFavorite && b.isFavorite) return 1;  // `b` is a favorite, `a` is not

                    // If both are either favorites or non-favorites, sort by name
                    return a.name.localeCompare(b.name);
                }
            )
            .forEach(project => {
                const option = document.createElement('option');
                option.value = project.id; // Use project ID as the value
                option.textContent = project.name; // Use project name as the display text

                // Highlight the favorite projects
                if (project.isFavorite) {
                    option.style.fontWeight = 'bold'; // Bold the text
                    option.style.color = 'gold'; // Change text color to gold
                    option.textContent = `⭐ ${project.name}`; // Add a star icon before the name
                }

                taskProjectSelection.appendChild(option);
            }
        );
    }

    getUpdateTaskObject(): UpdateTaskArgs {
        let dur: number = this.taskDuration;
        let unit: string = this.taskDurationUnit;
        if (unit === 'minute') {
            dur = this.isTaskDateTimed ? this.taskDuration : 0;
            unit = 'minute';
            this.shouldConvertHours = false;
        } else if (unit === 'hour') {
            dur = this.isTaskDateTimed ? this.taskDuration * 60 : 0;
            unit = 'minute';
            this.shouldConvertMinutes = false;
        } else {
            dur = this.isTaskDateTimed ? this.taskDuration : 0;
            unit = this.taskDurationUnit !== 'hour' ? this.taskDurationUnit : 'minute';
        }

        // (`RESULT: ${dur} ${unit}`);
        return {
            content: this.taskName,
            description: this.taskDescription,
            priority: this.taskPriority,
            labels: this.taskLabels,
            dueString: this.taskString,
            duration: dur,
            durationUnit: unit as AllowedDurationUnit,
            assigneeId: this.taskDetails.assigneeId,
        }
    }

    getTaskObject(): Task {
        return {
            id: this.taskId,
            content: this.taskName,
            description: this.taskDescription,
            projectId: this.selectedProjectId,
            priority: this.taskPriority,
            order: this.taskOrder,
            isCompleted: this.taskIsCompleted,
            labels: this.taskLabels,
            commentCount: this.taskCommentCount,
            createdAt: this.taskCreatedAt,
            url: this.taskUrl,
            creatorId: this.taskCreatorId,
            due: {
                string: this.taskString,
                isRecurring: this.taskIsRecurring,
                date: this.taskDate,
                datetime: this.taskDateTime,
                timezone: this.taskDetails.due?.timezone ?? 'America/New_York',
                lang: 'en',
            },
            duration: {
                amount: this.taskDuration,
                unit: this.taskDurationUnit as AllowedDurationUnit,
            },
            assigneeId: this.taskDetails.assigneeId,
            assignerId: this.taskDetails.assignerId,
            parentId: this.selectedProjectId,
            sectionId: this.taskDetails.sectionId,
        }
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

/**
 * Credit to @todoist-plugin
 */
export class TodoistApiError extends Error {
	public statusCode: number;
	
	constructor(request: RequestParams, response: WebResponse) {
		const message = `[${request.method}] ${request.url} returned '${response.statusCode}: ${response.body}`;
		super(message);
		this.statusCode = response.statusCode;
	}
}
import { Editor, MarkdownView, Plugin, Modal, App } from 'obsidian';
import ReactPlayer from 'react-player/lazy'

import { VideoView, VIDEO_VIEW } from './view/VideoView';
import { TimestampPluginSettings, TimestampPluginSettingTab, DEFAULT_SETTINGS } from 'settings';

const ERRORS: { [key: string]: string } = {
	"INVALID_URL": "\n> [!error] Invalid Video URL\n> The highlighted link is not a valid video url. Please try again with a valid link.\n",
	"NO_ACTIVE_VIDEO": "\n> [!caution] Select Video\n> A video needs to be opened before using this hotkey.\n Highlight your video link and input your 'Open video player' hotkey to register a video.\n",
}

export default class TimestampPlugin extends Plugin {
	settings: TimestampPluginSettings;
	player: ReactPlayer;
	setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
	setPlaybackRate: React.Dispatch<React.SetStateAction<number>>;
	editor: Editor;
	

	async onload() {
		// Register view
		this.registerView(
			VIDEO_VIEW,
			(leaf) => new VideoView(leaf)
		);

		// Register settings
		await this.loadSettings();

		// Markdown processor that turns timestamps into buttons
		this.registerMarkdownCodeBlockProcessor("timestamp", (source, el, ctx) => {
			// Match mm:ss or hh:mm:ss timestamp format
			const regExp = /\d+:\d+:\d+|\d+:\d+/g;
			const rows = source.split("\n").filter((row) => row.length > 0);
			rows.forEach((row) => {
				const match = row.match(regExp);
				if (match) {
					//create button for each timestamp
					const div = el.createEl("div");
					const button = div.createEl("button");
					button.innerText = match[0];
					button.style.backgroundColor = this.settings.timestampColor;
					button.style.color = this.settings.timestampTextColor;

					// convert timestamp to seconds and seek to that position when clicked
					button.addEventListener("click", () => {
						const timeArr = match[0].split(":").map((v) => parseInt(v));
						const [hh, mm, ss] = timeArr.length === 2 ? [0, ...timeArr] : timeArr;
						const seconds = (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0);
						if (this.player) this.player.seekTo(seconds);
					});
					div.appendChild(button);
				}
			})
		});


		// Markdown processor that turns video urls into buttons to open views of the video
		this.registerMarkdownCodeBlockProcessor("timestamp-url", (source, el, ctx) => {
			const url = source.trim();
			if (ReactPlayer.canPlay(url)) {
				// Creates button for video url
				const div = el.createEl("div");
				const button = div.createEl("button");
				button.innerText = url;
				button.style.backgroundColor = this.settings.urlColor;
				button.style.color = this.settings.urlTextColor;

				button.addEventListener("click", () => {
					this.activateView(url, this.editor);
				});
			} else {
				if (this.editor) {
					this.editor.replaceSelection(this.editor.getSelection() + "\n" + ERRORS["INVALID_URL"]);
				}
			}
		});

		// Command that gets selected video link and sends it to view which passes it to React component
		this.addCommand({
			id: 'trigger-player',
			name: 'Open video player (copy video url and use hotkey)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				// Get selected text and match against video url to convert link to video video id
				const url = editor.getSelection().trim();
				
				// Activate the view with the valid link
				if (ReactPlayer.canPlay(url)) {
					this.activateView(url, editor);
					this.settings.noteTitle ?
						editor.replaceSelection("\n" + this.settings.noteTitle + "\n" + "```timestamp-url \n " + url + "\n ```\n") :
						editor.replaceSelection("```timestamp-url \n " + url + "\n ```\n")
					this.editor = editor;
				} else {
					editor.replaceSelection(ERRORS["INVALID_URL"])
				}
				editor.setCursor(editor.getCursor().line + 2);
				editor.focus();
			}
		});

		// This command inserts the timestamp of the playing video into the editor
		this.addCommand({
			id: 'timestamp-insert',
			name: 'Insert timestamp based on videos current play time',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (!this.player) {
					editor.replaceSelection(ERRORS["NO_ACTIVE_VIDEO"])
					return
				}

				// convert current video time into timestamp
				const leadingZero = (num: number) => num < 10 ? "0" + num.toFixed(0) : num.toFixed(0);
				const totalSeconds = Number(this.player.getCurrentTime().toFixed(2));
				const hours = Math.floor(totalSeconds / 3600);
				const minutes = Math.floor((totalSeconds - (hours * 3600)) / 60);
				const seconds = totalSeconds - (hours * 3600) - (minutes * 60);
				const time = (hours > 0 ? leadingZero(hours) + ":" : "") + leadingZero(minutes) + ":" + leadingZero(seconds);

				// insert timestamp into editor
				editor.replaceSelection("```timestamp \n " + time + "\n ```\n")
			}
		});

		//Command that play/pauses the video
		this.addCommand({
			id: 'pause-player',
			name: 'Pause player',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.setPlaying(!this.player.props.playing)
			}
		});

		// Seek forward by set amount of seconds
		this.addCommand({
			id: 'seek-forward',
			name: 'Seek Forward',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) this.player.seekTo(this.player.getCurrentTime() + parseInt(this.settings.forwardSeek));
			}
		});

		// Seek backwards by set amount of seconds
		this.addCommand({
			id: 'seek-backward',
			name: 'Seek Backward',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) this.player.seekTo(this.player.getCurrentTime() - parseInt(this.settings.backwardsSeek));
			}
		});

		// Increase youtube player playback speed
		this.addCommand({
			id: 'increase-play-speed',
			name: 'Increase Play Speed',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) {
					if(this.player.props.playbackRate < 2)
					this.setPlaybackRate(this.player.props.playbackRate + 0.25);
				}
			}
		});

		// Decrease youtube player playback speed
		this.addCommand({
			id: 'decrease-play-speed',
			name: 'Decrease Play Speed',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (this.player) {
					if(this.player.props.playbackRate > 0.25)
					this.setPlaybackRate(this.player.props.playbackRate - 0.25);
				}
			}
		});

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.editor = editor;
				new SampleModal(this.app, this.activateView.bind(this), editor).open();
				// This command will only show up in Command Palette when the check function returns true
				return true;
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new TimestampPluginSettingTab(this.app, this));
	}

	async onunload() {
		this.player = null;
		this.editor = null;
		this.setPlaying = null;
		this.setPlaybackRate = null;
		this.app.workspace.detachLeavesOfType(VIDEO_VIEW);
	}

	// This is called when a valid url is found => it activates the View which loads the React view
	async activateView(url: string, editor: Editor) {
		this.app.workspace.detachLeavesOfType(VIDEO_VIEW);

		await this.app.workspace.getRightLeaf(false).setViewState({
			type: VIDEO_VIEW,
			active: true,
		});

		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(VIDEO_VIEW)[0]
		);

		// This triggers the React component to be loaded
		this.app.workspace.getLeavesOfType(VIDEO_VIEW).forEach(async (leaf) => {
			if (leaf.view instanceof VideoView) {

				const setupPlayer = (player: ReactPlayer, setPlaying: React.Dispatch<React.SetStateAction<boolean>>, setPlaybackRate: React.Dispatch<React.SetStateAction<number>>) => {
					this.player = player;
					this.setPlaying = setPlaying;
					this.setPlaybackRate = setPlaybackRate;
				}

				const setupError = (err: string) => {
					editor.replaceSelection(editor.getSelection() + `\n> [!error] Streaming Error \n> ${err}\n`);
				}

				const saveTimeOnUnload = async () => {
					if (this.player) {
						this.settings.urlStartTimeMap.set(url, Number(this.player.getCurrentTime().toFixed(0)));
					}
					await this.saveSettings();
				}

				// create a new video instance, sets up state/unload functionality, and passes in a start time if available else 0
				leaf.setEphemeralState({
					url,
					setupPlayer,
					setupError,
					saveTimeOnUnload,
					start: ~~this.settings.urlStartTimeMap.get(url)
				});

				await this.saveSettings();
			}
		});
	}

	async loadSettings() {
		// Fix for a weird bug that turns default map into a normal object when loaded
		const data = await this.loadData()
		if (data) {
			const map = new Map(Object.keys(data.urlStartTimeMap).map(k => [k, data.urlStartTimeMap[k]]))
			this.settings = { ...DEFAULT_SETTINGS, ...data, urlStartTimeMap: map };
		} else {
			this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

}

class SampleModal extends Modal {
	editor: Editor;
	activateView: (url: string, editor: Editor) => void;
	constructor(app: App, activateView: (url: string, editor: Editor) => void, editor: Editor) {
		super(app);
		this.activateView = activateView;
		this.editor = editor;
	}

	onOpen() {
		const { contentEl } = this;
		// add an input field to contentEl

		const input = contentEl.createEl('input');
		input.setAttribute("type", "file");
		input.onchange = (e: any) => {
			// accept local video input and make a url from input
			const url = URL.createObjectURL(e.target.files[0]);
			this.activateView(url, this.editor);

			// Can't get the buttons to work with local videos unfortunately
			// this.editor.replaceSelection("\n" + "```timestamp-url \n " + url.trim() + "\n ```\n")
			this.close();
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

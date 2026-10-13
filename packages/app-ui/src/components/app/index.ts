import Root from "./app.svelte";
import Bar from "./app-bar.svelte";
import Body from "./app-body.svelte";
import Group from "./app-group.svelte";
import Section from "./app-section.svelte";
import Sidebar from "./app-sidebar.svelte";
import Main from "./app-main.svelte";
import Title from "./app-title.svelte";

export { appVariants, appWindow, type AppSize } from "./app.svelte";

export {
	Root,
	Bar,
	Title,
	Body,
	Sidebar,
	Main,
	Section,
	Group,
	//
	Root as App,
	Bar as AppBar,
	Title as AppTitle,
	Body as AppBody,
	Sidebar as AppSidebar,
	Main as AppMain,
	Section as AppSection,
	Group as AppGroup,
};

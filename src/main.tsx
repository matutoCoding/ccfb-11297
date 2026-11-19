import { render } from 'preact';
import { App } from './ui/App';
import './ui/styles.css';
import { appStore } from './state/AppStore';

async function bootstrap(): Promise<void> {
  render(<App loading />, document.getElementById('app')!);
  await appStore.initGpu();
  await appStore.loadProjects();
  render(<App />, document.getElementById('app')!);
}

bootstrap();

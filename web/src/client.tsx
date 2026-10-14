import { hydrateRoot } from 'react-dom/client';
import PackStudio from './components/PackStudio';
import { resolveLocale } from './i18n';

const studio = document.getElementById('studio')!;
hydrateRoot(studio, <PackStudio locale={resolveLocale(studio.dataset.locale)} />);

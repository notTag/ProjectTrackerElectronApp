import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'

import App from './App.vue'
import { webBridge } from './services/webBridge'
import { applyUiDemo } from './uiDemo'
import BoardView from './views/BoardView.vue'
import DashboardView from './views/DashboardView.vue'
import './styles.css'

// The web build has no preload; install the HTTP bridge before anything reads
// window.projectTracker. MODE is a build-time constant, so desktop builds drop it.
if (import.meta.env.MODE === 'web') window.projectTracker = webBridge

// Before mount so stored UI Demo values paint on the first frame.
applyUiDemo()

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/board/:projectPath', component: BoardView }
  ]
})

createApp(App).use(createPinia()).use(router).mount('#app')

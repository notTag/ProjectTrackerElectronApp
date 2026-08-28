import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'

import App from './App.vue'
import BoardView from './views/BoardView.vue'
import DashboardView from './views/DashboardView.vue'
import './styles.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/board/:projectPath', component: BoardView }
  ]
})

createApp(App).use(createPinia()).use(router).mount('#app')

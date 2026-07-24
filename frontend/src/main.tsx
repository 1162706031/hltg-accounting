import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App'
import { QueryProvider } from './components/QueryProvider'
import { SystemSettingsProvider } from './utils/SystemSettingsContext'
import './styles.css'

dayjs.locale('zh-cn')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          borderRadius: 8,
          colorPrimary: '#1767e8',
          colorText: '#172033',
          colorTextSecondary: '#667085',
          colorBorder: '#dfe4ec',
          colorBgLayout: '#f3f5f8',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
        },
        components: {
          Button: { controlHeight: 36, fontWeight: 500 },
          Card: { headerFontSize: 16 },
          Menu: { itemBorderRadius: 6, itemMarginInline: 10 }
        }
      }}
    >
      <AntApp>
        <SystemSettingsProvider>
          <QueryProvider>
            <App />
          </QueryProvider>
        </SystemSettingsProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
)

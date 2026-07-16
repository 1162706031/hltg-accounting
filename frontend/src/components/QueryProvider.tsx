import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp } from 'antd'
import { PropsWithChildren, useState } from 'react'
import { getErrorMessage } from '../api/client'

export function QueryProvider({ children }: PropsWithChildren) {
  const { message } = AntApp.useApp()
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => message.error(getErrorMessage(error, '数据加载失败，请稍后重试'))
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            // 页面已有业务化提示时由页面处理；这里只兜住漏配 onError 的操作。
            if (!mutation.options.onError) {
              message.error(getErrorMessage(error))
            }
          }
        })
      })
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

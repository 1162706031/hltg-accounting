import type { TablePaginationConfig } from 'antd'
import type { PageResult } from '../api/client'

export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = ['10', '20', '50', '100', '200', '500']

export function tablePagination<T>(
  data: PageResult<T> | undefined,
  page: number,
  pageSize: number,
  setPage: (page: number) => void,
  setPageSize: (pageSize: number) => void
): TablePaginationConfig {
  return {
    current: page,
    pageSize,
    total: data?.total ?? 0,
    showSizeChanger: true,
    showQuickJumper: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
    onChange: (nextPage, nextPageSize) => {
      setPage(nextPage)
      setPageSize(nextPageSize)
    }
  }
}

export function localTablePagination(
  total: number,
  pageSize: number,
  setPageSize: (pageSize: number) => void
): TablePaginationConfig {
  return {
    pageSize,
    total,
    showSizeChanger: true,
    showQuickJumper: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    showTotal: (count, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${count} 条`,
    onShowSizeChange: (_page, nextPageSize) => setPageSize(nextPageSize)
  }
}

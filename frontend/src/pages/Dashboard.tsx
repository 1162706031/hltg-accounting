import { Card, Col, Row, Statistic, Typography } from 'antd'

export function Dashboard() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">工作台</h1>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="库存模块" value="已接入" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="对账模块" value="已接入" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="财务记录" value="已接入" />
          </Card>
        </Col>
      </Row>
      <Card>
        <Typography.Paragraph>
          当前版本已经搭好后端 API、认证、主数据、库存事务、收付款、开票和对账基础能力。
        </Typography.Paragraph>
      </Card>
    </div>
  )
}

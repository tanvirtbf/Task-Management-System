import { NavLink, Navigate, Outlet } from "react-router-dom";
import Icon from "@ant-design/icons";
import { useAuthStore } from "../store";
import { Layout, Menu, theme } from "antd";
import { useState } from "react";
import Logo from "../components/icons/Logo";
import Home from "../components/icons/Home";
import UserIcon from "../components/icons/UserIcon";

const { Sider, Header, Content, Footer } = Layout;

const items = [
    {
        key: "/",
        icon: <Icon component={Home} />,
        label: <NavLink to="/">Home</NavLink>,
    },
    {
        key: "/users",
        icon: <Icon component={UserIcon} />,
        label: <NavLink to="/users">Users</NavLink>,
    },
];

const Dashboard = () => {
    const [collapsed, setCollapsed] = useState(false);
    const {
        token: { colorBgContainer },
    } = theme.useToken();

    const { user } = useAuthStore();
    if (user === null) {
        return <Navigate to="/auth/login" replace={true} />;
    }

    return (
        <div>
            <Layout style={{ minHeight: "100vh", background: colorBgContainer }}>
                <Sider
                    collapsible
                    theme="light"
                    collapsed={collapsed}
                    onCollapse={(value) => setCollapsed(value)}
                >
                    <div className="logo">
                        <Logo />
                    </div>
                    <Menu
                        theme="light"
                        defaultSelectedKeys={["/"]}
                        mode="inline"
                        items={items}
                    />
                </Sider>
                <Layout>
                    <Header style={{ padding: 0, background: colorBgContainer }} />
                    <Content style={{ margin: "0 16px" }}>
                        <Outlet />
                    </Content>
                    <Footer style={{ textAlign: "center" }}>
                        Task Management System
                    </Footer>
                </Layout>
            </Layout>
        </div>
    );
};

export default Dashboard;

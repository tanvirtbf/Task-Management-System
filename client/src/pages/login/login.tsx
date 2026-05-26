import {
    Alert,
    Button,
    Card,
    Checkbox,
    Flex,
    Form,
    Input,
    Layout,
    Space,
} from "antd";
import { LockFilled, LockOutlined, UserOutlined } from "@ant-design/icons";
import Logo from "../../components/icons/Logo";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Credentials } from "../../type";
import { login, logout, self } from "../../http/api";
import { useAuthStore } from "../../store";
import { usePermission } from "../../hooks/usePermission";

const loginUser = async (credentials: Credentials) => {
    const { data } = await login(credentials);
    return data;
};

const getSelf = async () => {
    const { data } = await self();
    return data;
};

const LoginPage = () => {
    const { isAllowed } = usePermission();
    const { setUser, logout: logoutFromStore } = useAuthStore();

    const { refetch } = useQuery({
        queryKey: ["self"],
        queryFn: getSelf,
        enabled: false,
    });

    const { mutate: logoutMutate } = useMutation({
        mutationKey: ["logout"],
        mutationFn: logout,
        onSuccess: async () => {
            logoutFromStore();
        },
    });

    const { mutate, isPending, isError, error } = useMutation({
        mutationKey: ["login"],
        mutationFn: loginUser,
        onSuccess: async () => {
            const selfDataPromise = await refetch();

            if (!isAllowed(selfDataPromise.data)) {
                logoutMutate();
                return;
            }
            setUser(selfDataPromise.data);
        },
    });

    return (
        <>
            <Layout
                style={{ height: "100vh", display: "grid", placeItems: "center" }}
            >
                <Space direction="vertical" align="center" size={"large"}>
                    <Layout.Content>
                        <Logo />
                    </Layout.Content>
                    <Card
                        variant="borderless"
                        title={
                            <Space
                                style={{
                                    width: "100%",
                                    fontSize: 16,
                                    justifyContent: "center",
                                }}
                            >
                                <LockFilled />
                                Sign in
                            </Space>
                        }
                        style={{ width: 300 }}
                    >
                        <Form
                            initialValues={{ remember: true }}
                            onFinish={(values) => {
                                mutate({
                                    email: values.username,
                                    password: values.password,
                                });
                            }}
                        >
                            <Form.Item
                                name={"username"}
                                rules={[
                                    {
                                        required: true,
                                        message: "Please input your username",
                                    },
                                    {
                                        type: "email",
                                        message: "Email is not Valid",
                                    },
                                ]}
                            >
                                <Input prefix={<UserOutlined />} placeholder="Username" />
                            </Form.Item>
                            <Form.Item name={"password"}>
                                <Input.Password
                                    prefix={<LockOutlined />}
                                    placeholder="Password"
                                />
                            </Form.Item>
                            <Flex justify="space-between">
                                <Form.Item name={"remember"} valuePropName="checked">
                                    <Checkbox>Remember Me</Checkbox>
                                </Form.Item>
                                <a href="#" style={{ paddingTop: "8px", fontSize: "12px" }}>
                                    Forgot Password
                                </a>
                            </Flex>
                            {isError && <Alert type="error" message={error.message} />}
                            <Form.Item>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    style={{ width: "100%" }}
                                    loading={isPending}
                                >
                                    Login
                                </Button>
                            </Form.Item>
                        </Form>
                    </Card>
                </Space>
            </Layout>
        </>
    );
};

export default LoginPage;

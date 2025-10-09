"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  Home,
  Settings,
  Zap,
  Circle,
  BookOpen,
  HelpCircle,
  RefreshCw,
  Bug,
  Target,
} from "lucide-react"

import { RateLimitSidebar } from "@/components/RateLimitSidebar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useConfig } from "@/components/ConfigProvider"
import { useBotStatus } from "@/hooks/useBotStatus"
import websocketService from '@/lib/services/websocketService'
import dataStore from '@/lib/services/dataStore'
import { VersionChecker } from '@/components/VersionChecker'

const navigation = [
  {
    title: "Dashboard",
    icon: Home,
    href: "/",
  },
  {
    title: "Configuration",
    icon: Settings,
    href: "/config",
  },
  {
    title: "Optimizer",
    icon: Target,
    href: "/optimizer",
  },
  {
    title: "Wiki & Help",
    icon: BookOpen,
    href: "/wiki",
  },
  {
    title: "Error Logs",
    icon: Bug,
    href: "/errors",
  },
]


export function AppSidebar() {
  const pathname = usePathname()
  const { config } = useConfig()
  const { status, isConnected } = useBotStatus()
  const [positions, setPositions] = React.useState<any[]>([])
  const isPaperMode = config?.global?.paperMode

  // Load positions and listen for updates
  React.useEffect(() => {
    // Load initial positions from data store
    dataStore.fetchPositions()
      .then(data => setPositions(data))
      .catch(error => console.error('[AppSidebar] Failed to load positions:', error))

    // Subscribe to position updates from data store
    const handlePositionsUpdate = (data: any[]) => {
      setPositions(data)
    }

    dataStore.on('positions:update', handlePositionsUpdate)

    // Forward WebSocket messages to data store
    const handleMessage = (message: any) => {
      dataStore.handleWebSocketMessage(message)
    }

    const cleanup = websocketService.addMessageHandler(handleMessage)

    return () => {
      dataStore.off('positions:update', handlePositionsUpdate)
      cleanup()
    }
  }, [])


  const getStatusColor = () => {
    if (!isConnected) return 'bg-red-500'
    if (!status?.isRunning) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const getStatusText = () => {
    if (!isConnected) return 'Disconnected'
    if (!status?.isRunning) return 'Connected'
    return 'Running'
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Aster Hunter</span>
            <Badge variant={isPaperMode ? "secondary" : "default"} className="w-fit text-xs">
              {isPaperMode ? "Paper Mode" : "Live Trading"}
            </Badge>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href}
                  >
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarSeparator />

      {/* Bot Status Section */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Bot Status</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="space-y-3 px-2">
              {/* Connection Status */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <div className="flex items-center gap-2">
                  <Circle className={`h-2 w-2 fill-current ${getStatusColor()} ${isConnected && status?.isRunning ? 'animate-pulse' : ''}`} />
                  <span className="text-sm font-medium">{getStatusText()}</span>
                </div>
              </div>

              {/* Mode */}
              {isConnected && status && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Mode</span>
                    <Badge
                      variant={status.paperMode ? "secondary" : "default"}
                      className="h-5 px-2 text-xs font-medium"
                    >
                      {status.paperMode ? "Paper" : "Live"}
                    </Badge>
                  </div>

                  {/* Positions */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Positions</span>
                    <span className="text-sm font-medium">{positions.length}</span>
                  </div>
                </>
              )}

              {/* Rate Limits */}
              {isConnected && (
                <div className="mt-3 pt-3 border-t border-sidebar-border">
                  <RateLimitSidebar />
                </div>
              )}
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      {/* Help Section */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Help & Resources</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="space-y-2 px-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  // Trigger tutorial restart
                  const event = new CustomEvent('restart-tutorial');
                  window.dispatchEvent(event);
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Restart Tutorial
              </Button>
              <Link href="/wiki/getting-started">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                >
                  <HelpCircle className="mr-2 h-4 w-4" />
                  Getting Started
                </Button>
              </Link>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="space-y-1">
          {/* Connection Status */}
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Connection</span>
              <div className="flex items-center gap-1">
                {isConnected ? (
                  <>
                    <Activity className="h-3 w-3 text-green-500 animate-pulse" />
                    <span className="text-green-500">Connected</span>
                  </>
                ) : (
                  <>
                    <Activity className="h-3 w-3 text-red-500" />
                    <span className="text-red-500">Disconnected</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Version Status */}
          <VersionChecker />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
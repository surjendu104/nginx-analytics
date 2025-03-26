'use client';

import { useEffect, useState } from "react";
import { NginxLog } from "../types";
import { getUserId } from "../user";
import { getPeriodRange, hoursInRange, Period, periodStart } from "../period";

function getUsers(data: NginxLog[], period: Period) {
    const startDate = periodStart(period);
    const endDate = new Date(); // Current time as end date
    
    // Filter data by period if startDate is available
    let filteredData = [...data];
    if (startDate) {
        filteredData = filteredData.filter(log => {
            const logDate = new Date(log.timestamp || 0);
            return logDate >= startDate && logDate <= endDate;
        });
    }
    
    const users = new Set<string>();
    for (const row of filteredData) {
        const userId = getUserId(row.ipAddress, row.userAgent);
        if (userId) {
            users.add(userId);
        }
    }
    return users;
}

function getUserCount(data: NginxLog[], period: Period) {
    return getUsers(data, period).size;
}

function getUsersByTime(data: NginxLog[], period: Period) {
    // Get period start date (if applicable)
    const startDate = periodStart(period);
    const endDate = new Date(); // Current time as end date
    
    // Filter data by period if startDate is available
    let filteredData = [...data];
    if (startDate) {
        filteredData = filteredData.filter(log => {
            const logDate = new Date(log.timestamp || 0);
            return logDate >= startDate && logDate <= endDate;
        });
    }
    
    // Sort data by timestamp
    const sortedData = filteredData.sort((a, b) => {
        return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
    });
    
    // Determine appropriate bucket size based on period
    const bucketFormat: 'hour' | 'day' = period === '24 hours' ? 'hour' : 'day';
    
    // Generate all time buckets within the period range
    const allBuckets = new Map<string, number>();
    
    if (startDate) {
        // Clone dates to avoid modifying the original
        const currentDate = new Date(startDate.getTime());
        
        while (currentDate <= endDate) {
            let timeKey: string;
            
            if (bucketFormat === 'hour') {
                // Format: YYYY-MM-DD HH
                timeKey = `${currentDate.toISOString().split('T')[0]} ${currentDate.getHours()}`;
                // Advance by 1 hour
                currentDate.setHours(currentDate.getHours() + 1);
            } else if (bucketFormat === 'day') {
                // Format: YYYY-MM-DD
                timeKey = currentDate.toISOString().split('T')[0];
                // Advance by 1 day
                currentDate.setDate(currentDate.getDate() + 1);
            } else {
                // Format: YYYY-MM
                timeKey = currentDate.toISOString().substring(0, 7);
                // Advance by 1 month
                currentDate.setMonth(currentDate.getMonth() + 1);
            }
            
            allBuckets.set(timeKey, 0);
        }
    }
    
    // Count unique users per time bucket (first appearance only)
    // const seenUsers = new Set<string>();
    
    for (const row of sortedData) {
        const userId = getUserId(row.ipAddress, row.userAgent);
        if (!userId) continue;
        
        // Skip if we've already counted this user
        // if (seenUsers.has(userId)) continue;
        // seenUsers.add(userId);
        
        const timestamp = new Date(row.timestamp || 0);
        let timeKey: string;
        
        if (bucketFormat === 'hour') {
            // Format: YYYY-MM-DD HH
            timeKey = `${timestamp.toISOString().split('T')[0]} ${timestamp.getHours()}`;
        } else if (bucketFormat === 'day') {
            // Format: YYYY-MM-DD
            timeKey = timestamp.toISOString().split('T')[0];
        } else {
            // Format: YYYY-MM
            timeKey = timestamp.toISOString().substring(0, 7);
        }
        
        if (!allBuckets.has(timeKey)) {
            // If we have no defined time period, or data outside our range,
            // add the bucket dynamically
            allBuckets.set(timeKey, 1);
        } else {
            // Increment existing bucket
            allBuckets.set(timeKey, allBuckets.get(timeKey)! + 1);
        }
    }
    
    // Convert to array of points for graphing
    const buckets = Array.from(allBuckets.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ date, count }));
    
    // If no period is specified and no data, return empty array
    if (buckets.length === 0) {
        return [];
    }
    
    // Consolidate into 6 buckets if we have more
    if (buckets.length > 6) {
        const bucketSize = Math.ceil(buckets.length / 6);
        const consolidatedBuckets = [];
        
        for (let i = 0; i < buckets.length; i += bucketSize) {
            const chunk = buckets.slice(i, i + bucketSize);
            const totalCount = chunk.reduce((sum, b) => sum + b.count, 0);
            consolidatedBuckets.push({
                date: chunk[0].date,
                count: totalCount
            });
        }
        
        return consolidatedBuckets;
    }
    
    return buckets;
}

export default function Users({ data, period }: { data: NginxLog[], period: Period }) {
    const [users, setUsers] = useState<{total: number, perHour: number}>({total: 0, perHour: 0});
    const [userTrend, setUserTrend] = useState<Array<{date: string, count: number}>>([]);
    const [displayMode, setDisplayMode] = useState<'total' | 'per-hour'>('total');

    useEffect(() => {
        const range = getPeriodRange(period, data);
        if (!range) return;

        const totalUsers = getUserCount(data, period);

        const usersPerHour = totalUsers / hoursInRange(range.start, range.end);
        setUsers({total: totalUsers, perHour: usersPerHour});
        setUserTrend(getUsersByTime(data, period));
    }, [data, period]);


    // Toggle display mode
    const toggleDisplayMode = () => {
        setDisplayMode(current =>
            current === 'total' ? 'per-hour' : 'total'
        );
    };

    // Calculate the path for the background graph
    const renderBackgroundGraph = () => {
        if (!userTrend.length) return null;
        
        // Find the maximum value for scaling
        const maxCount = Math.max(...userTrend.map(b => b.count), 1); // Ensure non-zero divisor
        
        // Graph dimensions
        const width = 100; // percentage width
        const height = 40; // pixels for graph height
        
        // Handle special cases with few data points
        if (userTrend.length === 1) {
            // For a single data point, create a bell curve shape
            return (
                <svg
                    className="absolute bottom-0 left-0 w-full h-10"
                    preserveAspectRatio="none"
                    viewBox={`0 0 ${width} ${height}`}
                >
                    <path
                        d={`
                            M 0,${height}
                            C 20,${height} 30,${height - (height * 0.2)} 40,${height - (height * 0.8)}
                            C 45,${height - (height * 1)} 55,${height - (height * 1)} 60,${height - (height * 0.8)}
                            C 70,${height - (height * 0.2)} 80,${height} 100,${height}
                            Z
                        `}
                        fill="var(--highlight)"
                        stroke="none"
                    />
                </svg>
            );
        } else if (userTrend.length === 2) {
            // For two data points, create a smoother transition between them
            const point1Y = height - (userTrend[0].count / maxCount) * height;
            const point2Y = height - (userTrend[1].count / maxCount) * height;
            
            return (
                <svg
                    className="absolute bottom-0 left-0 w-full h-10"
                    preserveAspectRatio="none"
                    viewBox={`0 0 ${width} ${height}`}
                >
                    <path
                        d={`
                            M 0,${height}
                            L 0,${point1Y}
                            C 25,${point1Y} 25,${point2Y} 50,${point2Y}
                            C 75,${point2Y} 75,${height} 100,${height}
                            Z
                        `}
                        fill="var(--highlight)"
                        stroke="none"
                    />
                </svg>
            );
        }
        
        // Calculate points for normal case (3+ data points)
        const points = userTrend.map((bucket, index) => {
            const x = (index / (userTrend.length - 1 || 1)) * width;
            const y = height - (bucket.count / maxCount) * height;
            return `${x},${y}`;
        });
        
        // Create a smooth path with better curve handling
        let pathData = `M 0,${height} L 0,${points[0]?.split(',')[1] || height}`;
        
        // Add smooth curves between points
        for (let i = 1; i < points.length; i++) {
            const prevPoint = points[i-1].split(',').map(Number);
            const currPoint = points[i].split(',').map(Number);
            
            // Control points for the bezier curve
            const cpX1 = prevPoint[0] + (currPoint[0] - prevPoint[0]) / 3;
            const cpX2 = prevPoint[0] + 2 * (currPoint[0] - prevPoint[0]) / 3;
            
            pathData += ` C ${cpX1},${prevPoint[1]} ${cpX2},${currPoint[1]} ${currPoint[0]},${currPoint[1]}`;
        }
        
        // Close the path
        pathData += ` L ${width},${height} Z`;
        
        return (
            <svg
                className="absolute bottom-0 left-0 w-full h-10"
                preserveAspectRatio="none"
                viewBox={`0 0 ${width} ${height}`}
            >
                <path
                    d={pathData}
                    fill="var(--highlight)"
                    stroke="none"
                />
            </svg>
        );
    };

    return (
        <div
            className="card flex-1 px-4 py-3 m-3 relative overflow-hidden cursor-pointer"
            onClick={toggleDisplayMode}
        >
            <h2 className="font-semibold flex justify-between items-center">
                Users
                <span className="text-xs text-gray-500">
                    {displayMode !== 'total' ? '/ hour' : null}
                </span>
            </h2>

            <div className="text-3xl font-semibold grid place-items-center relative z-10">
                <div
                    className="py-4 text-[var(--text-tinted)]"
                    style={{ textShadow: "0px 0px 3px rgba(0,0,0,0.5)" }}
                >
                    {displayMode === 'total'
                        ? users.total.toLocaleString()
                        : users.perHour === 0 ? 0 : users.perHour.toFixed(2)
                    }
                </div>
            </div>

            {renderBackgroundGraph()}
        </div>
    );
}
output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.this.id
}

output "vpc_cidr_block" {
  description = "IPv4 CIDR block of the VPC."
  value       = aws_vpc.this.cidr_block
}

output "vpc_enable_dns_support" {
  description = "Whether DNS resolution is enabled in the VPC."
  value       = aws_vpc.this.enable_dns_support
}

output "vpc_enable_dns_hostnames" {
  description = "Whether DNS hostnames are enabled in the VPC."
  value       = aws_vpc.this.enable_dns_hostnames
}

output "internet_gateway_id" {
  description = "ID of the internet gateway attached to the VPC."
  value       = aws_internet_gateway.this.id
}

output "public_subnet_id" {
  description = "ID of the public subnet for the EC2 host."
  value       = aws_subnet.public.id
}

output "public_subnet_availability_zone" {
  description = "Availability zone of the public subnet."
  value       = aws_subnet.public.availability_zone
}

output "private_subnet_ids" {
  description = "IDs of the private subnets (for the RDS DB subnet group), one per availability zone."
  value       = aws_subnet.private[*].id
}

output "private_subnet_availability_zones" {
  description = "Availability zones of the private subnets, in the same order as private_subnet_ids."
  value       = aws_subnet.private[*].availability_zone
}

output "public_route_table_id" {
  description = "ID of the public route table."
  value       = aws_route_table.public.id
}

output "public_route_table_routes" {
  description = "Routes declared inline on the public route table."
  value       = aws_route_table.public.route
}

output "public_subnet_route_table_id" {
  description = "Route table the public subnet is associated with."
  value       = aws_route_table_association.public.route_table_id
}

output "private_route_table_id" {
  description = "ID of the private route table (no route to the internet)."
  value       = aws_route_table.private.id
}

output "private_route_table_routes" {
  description = "Routes declared inline on the private route table; empty by design."
  value       = aws_route_table.private.route
}

output "private_subnet_route_table_ids" {
  description = "Route table each private subnet is associated with, in the same order as private_subnet_ids."
  value       = aws_route_table_association.private[*].route_table_id
}
